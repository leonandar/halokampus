import type { PrismaClient } from "@hk/db";
import { safeEqual } from "../crypto.js";
import { renderFor } from "./render.js";
import { simulatorSend } from "./transport.js";
import type { ChannelAdapter, OutboundMessage, Recipient, SendResult } from "./types.js";
import type { InboundItem } from "./whatsapp.js";

/** Telegram Bot API update → inbound items (FR-50). The chat id is the channel identity. */
export function parseTelegramUpdate(u: any): InboundItem[] {
  if (u?.message?.chat?.id !== undefined) {
    const m = u.message;
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || undefined;
    return [{ from: String(m.chat.id), providerMessageId: String(m.message_id), profileName: name, text: m.text ? String(m.text) : m.document || m.photo ? "[lampiran]" : "" }];
  }
  if (u?.callback_query?.message?.chat?.id !== undefined) {
    const q = u.callback_query;
    return [{ from: String(q.message.chat.id), providerMessageId: `cb.${q.id}`, profileName: q.from?.first_name, controlId: String(q.data ?? "") }];
  }
  return [];
}

/** Telegram sends the secret configured with setWebhook in this header. */
export function verifyTelegramSecret(header: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true;
  return Boolean(header) && safeEqual(header!, secret);
}

export function renderTelegram(chatId: string, msg: OutboundMessage) {
  const r = renderFor("telegram", msg);
  const payload: Record<string, unknown> = { chat_id: chatId, text: r.body.slice(0, 4096) };
  // callback_data is limited to 64 bytes; all control ids used by haloK@MPUS fit.
  if (r.buttons.length) payload.reply_markup = { inline_keyboard: r.buttons.map((b) => [{ text: b.title, callback_data: b.id.slice(0, 64) }]) };
  return { payload, textOptions: r.textOptions };
}

export class TelegramChannel implements ChannelAdapter {
  readonly code = "telegram" as const;
  constructor(private readonly mode: "simulator" | "bot_api", private readonly db: PrismaClient, private readonly botToken?: string) {}
  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    const { payload, textOptions } = renderTelegram(to.externalId, msg);
    if (this.mode === "simulator") {
      return { providerMessageId: await simulatorSend(this.db, "telegram", to.externalId, payload, { messageId: msg.messageId, kind: msg.kind, sender: msg.senderLabel }), textOptions };
    }
    if (!this.botToken) throw new Error("Telegram bot token missing");
    const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`Telegram send failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: { message_id?: number } };
    return { providerMessageId: body.result?.message_id ? String(body.result.message_id) : null, textOptions };
  }
}
