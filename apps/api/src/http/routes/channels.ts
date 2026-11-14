import type { FastifyInstance } from "fastify";
import type { ChannelCode } from "@hk/shared";
import type { Ctx } from "../../context.js";
import { randomToken, safeEqual } from "../../crypto.js";
import { HttpError } from "../auth.js";
import { receiveInbound } from "../../services/pipeline.js";
import { applyDeliveryStatuses } from "../../services/delivery.js";
import { parseWhatsAppStatuses, parseWhatsAppWebhook, signMeta, verifyMetaSignature, type InboundItem } from "../../channels/whatsapp.js";
import { parseMetaMessaging } from "../../channels/meta.js";
import { parseTelegramUpdate, verifyTelegramSecret } from "../../channels/telegram.js";
import { parseInboundEmail } from "../../channels/email.js";

/**
 * Provider webhooks (FR-46…FR-50) and the development simulators (FR-52). Each simulator
 * builds the provider's own payload format and passes it through the same handler, so
 * signature checks, parsing and the AI/escalation pipeline are exercised end to end.
 */
export function registerChannelRoutes(app: FastifyInstance, ctx: Ctx) {
  const raw = (req: unknown) => (req as { rawBody?: string }).rawBody ?? JSON.stringify((req as { body: unknown }).body);

  async function deliver(channel: ChannelCode, items: InboundItem[]) {
    for (const m of items) await receiveInbound(ctx, { channel, externalId: m.from, displayName: m.profileName, text: m.controlId ? undefined : m.text, controlId: m.controlId });
  }

  // ---------------------------------------------------------------- handlers
  async function handleWhatsApp(body: string, signature?: string) {
    if (!verifyMetaSignature(body, signature, ctx.env.WHATSAPP_APP_SECRET)) throw new HttpError(401, "bad_signature", "Tanda tangan webhook tidak valid");
    const json = JSON.parse(body);
    await applyDeliveryStatuses(ctx, parseWhatsAppStatuses(json));
    await deliver("whatsapp", parseWhatsAppWebhook(json));
  }
  async function handleMeta(body: string, signature?: string) {
    if (!verifyMetaSignature(body, signature, ctx.env.META_APP_SECRET)) throw new HttpError(401, "bad_signature", "Tanda tangan webhook tidak valid");
    const parsed = parseMetaMessaging(JSON.parse(body));
    if (!parsed.channel) throw new HttpError(400, "unknown_object", "Objek webhook tidak dikenal");
    await applyDeliveryStatuses(ctx, parsed.statuses);
    await deliver(parsed.channel, parsed.items);
  }
  async function handleTelegram(body: unknown, secret?: string) {
    if (!verifyTelegramSecret(secret, ctx.env.TELEGRAM_WEBHOOK_SECRET)) throw new HttpError(401, "bad_secret", "Token rahasia webhook tidak valid");
    await deliver("telegram", parseTelegramUpdate(body));
  }
  async function handleEmail(body: unknown, token?: string) {
    if (ctx.env.EMAIL_WEBHOOK_TOKEN && !(token && safeEqual(token, ctx.env.EMAIL_WEBHOOK_TOKEN))) throw new HttpError(401, "bad_token", "Token webhook email tidak valid");
    await deliver("email", parseInboundEmail(body));
  }

  // ---------------------------------------------------------------- live webhooks
  const verify = (token: string | undefined) => async (req: { query: Record<string, string> }, reply: { type: (t: string) => { send: (b: string) => unknown } }) => {
    const q = req.query;
    if (q["hub.mode"] === "subscribe" && token && q["hub.verify_token"] === token) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    throw new HttpError(403, "forbidden", "Verifikasi webhook gagal");
  };
  app.get<{ Querystring: Record<string, string> }>("/webhooks/whatsapp", { config: { auth: "public" } }, verify(ctx.env.WHATSAPP_VERIFY_TOKEN) as never);
  app.get<{ Querystring: Record<string, string> }>("/webhooks/meta", { config: { auth: "public" } }, verify(ctx.env.META_VERIFY_TOKEN) as never);
  app.post("/webhooks/whatsapp", { config: { auth: "public" } }, async (req) => {
    await handleWhatsApp(raw(req), req.headers["x-hub-signature-256"] as string | undefined);
    return { ok: true };
  });
  app.post("/webhooks/meta", { config: { auth: "public" } }, async (req) => {
    await handleMeta(raw(req), req.headers["x-hub-signature-256"] as string | undefined);
    return { ok: true };
  });
  app.post("/webhooks/telegram", { config: { auth: "public" } }, async (req) => {
    await handleTelegram(req.body, req.headers["x-telegram-bot-api-secret-token"] as string | undefined);
    return { ok: true };
  });
  app.post("/webhooks/email", { config: { auth: "public" } }, async (req) => {
    await handleEmail(req.body, req.headers["x-webhook-token"] as string | undefined);
    return { ok: true };
  });

  if (!ctx.env.ENABLE_SIMULATORS) return;

  // ---------------------------------------------------------------- simulators
  const SIM_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram", "email"] as const;
  type SimChannel = (typeof SIM_CHANNELS)[number];
  const ts = () => Math.floor(Date.now() / 1000);

  app.post<{ Params: { channel: string }; Body: { from?: string; name?: string; text?: string; buttonId?: string; buttonTitle?: string; subject?: string; attachment?: boolean } }>(
    "/sim/:channel/send",
    { config: { auth: "public" } },
    async (req) => {
      const channel = req.params.channel as SimChannel;
      if (!SIM_CHANNELS.includes(channel)) throw new HttpError(404, "unknown_channel", "Simulator tidak dikenal");
      const b = req.body ?? {};
      const from = String(b.from ?? "").trim();
      if (!from) throw new HttpError(400, "invalid_from", "Pengirim wajib diisi");
      const id = randomToken(8);
      if (channel === "whatsapp") {
        const wa = from.replace(/\D/g, "");
        const msg = b.attachment
          ? { from: wa, id: `wamid.sim.${id}`, timestamp: String(ts()), type: "document", document: { filename: "berkas.pdf", mime_type: "application/pdf", id: "media.sim" } }
          : b.buttonId
          ? { from: wa, id: `wamid.sim.${id}`, timestamp: String(ts()), type: "interactive", interactive: { type: "button_reply", button_reply: { id: b.buttonId, title: b.buttonTitle ?? "" } } }
          : { from: wa, id: `wamid.sim.${id}`, timestamp: String(ts()), type: "text", text: { body: String(b.text ?? "") } };
        const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "SIM", changes: [{ field: "messages", value: { messaging_product: "whatsapp", contacts: [{ profile: { name: b.name ?? "Pengguna Simulator" }, wa_id: wa }], messages: [msg] } }] }] });
        await handleWhatsApp(body, ctx.env.WHATSAPP_APP_SECRET ? signMeta(body, ctx.env.WHATSAPP_APP_SECRET) : undefined);
      } else if (channel === "instagram" || channel === "messenger") {
        const message = b.attachment ? { mid: `m_sim_${id}`, attachments: [{ type: "file", payload: { url: "https://contoh.invalid/berkas.pdf" } }] } : b.buttonId ? { mid: `m_sim_${id}`, text: b.buttonTitle ?? "", quick_reply: { payload: b.buttonId } } : { mid: `m_sim_${id}`, text: String(b.text ?? "") };
        const body = JSON.stringify({ object: channel === "instagram" ? "instagram" : "page", entry: [{ id: "SIM_PAGE", time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: "SIM_PAGE" }, timestamp: Date.now(), message }] }] });
        await handleMeta(body, ctx.env.META_APP_SECRET ? signMeta(body, ctx.env.META_APP_SECRET) : undefined);
      } else if (channel === "telegram") {
        const user = { id: Number(from) || 1, is_bot: false, first_name: b.name ?? "Simulator" };
        const update = b.buttonId
          ? { update_id: ts(), callback_query: { id: id, from: user, data: b.buttonId, message: { message_id: ts(), chat: { id: Number(from), type: "private" } } } }
          : b.attachment
          ? { update_id: ts(), message: { message_id: ts(), from: user, chat: { id: Number(from), type: "private" }, date: ts(), document: { file_id: "sim", file_name: "berkas.pdf", file_size: 1000 } } }
          : { update_id: ts(), message: { message_id: ts(), from: user, chat: { id: Number(from), type: "private" }, date: ts(), text: String(b.text ?? "") } };
        await handleTelegram(update, ctx.env.TELEGRAM_WEBHOOK_SECRET);
      } else {
        await handleEmail({ from, name: b.name, subject: b.subject ?? "Pertanyaan PMB", text: String(b.text ?? ""), attachments: b.attachment ? [{ filename: "berkas.pdf", contentType: "application/pdf" }] : [], messageId: `<sim.${id}@contoh.invalid>` }, ctx.env.EMAIL_WEBHOOK_TOKEN);
      }
      return { ok: true };
    },
  );

  app.get<{ Params: { channel: string }; Querystring: { to?: string; after?: string } }>("/sim/:channel/outbox", { config: { auth: "public" } }, async (req) => {
    const channel = req.params.channel as SimChannel;
    if (!SIM_CHANNELS.includes(channel)) throw new HttpError(404, "unknown_channel", "Simulator tidak dikenal");
    const to = channel === "whatsapp" ? String(req.query.to ?? "").replace(/\D/g, "") : String(req.query.to ?? "").trim().toLowerCase();
    const rows = await ctx.db.simOutbox.findMany({ where: { channelCode: channel, recipient: { equals: to, mode: "insensitive" }, ...(req.query.after ? { createdAt: { gt: new Date(req.query.after) } } : {}) }, orderBy: { createdAt: "asc" }, take: 200 });
    return { items: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), payload: r.payload })) };
  });

  /** Simulates a provider "read" receipt for the given simulated messages. */
  app.post<{ Params: { channel: string }; Body: { providerMessageIds?: string[] } }>("/sim/:channel/read", { config: { auth: "public" } }, async (req) => {
    const ids = (req.body?.providerMessageIds ?? []).map(String).slice(0, 100);
    await applyDeliveryStatuses(ctx, ids.map((providerMessageId) => ({ providerMessageId, status: "read" as const })));
    return { ok: true };
  });
}
