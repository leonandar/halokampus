import { validateFile } from "@hk/ai";
import type { FastifyInstance } from "fastify";
import { CONSENT_PURPOSES, DSR_TYPES, type ConsentPurpose, type DsrType } from "@hk/shared";
import type { Ctx } from "../../context.js";
import { randomToken, sha256 } from "../../crypto.js";
import { HttpError } from "../auth.js";
import { consentState, hasConsent, profileOf, resolveCustomer, setConsents } from "../../services/customers.js";
import { appendEvent } from "../../services/ledger.js";
import { sendOutbound, viewMessage } from "../../services/messaging.js";
import { dataRightsLink, receiveInbound } from "../../services/pipeline.js";
import { openOrGetTicket } from "../../services/tickets.js";

const SESSION_TTL_MS = 30 * 24 * 3600_000;

export function registerPublicRoutes(app: FastifyInstance, ctx: Ctx) {
  async function webExternalId(customerId: string): Promise<string> {
    const id = await ctx.db.customerIdentity.findFirst({ where: { customerId, channelCode: "web" } });
    if (!id) throw new HttpError(404, "no_web_identity", "Identitas web tidak ditemukan");
    return ctx.crypto.decrypt(id.externalIdEnc);
  }

  // ------------------------------------------------------------ web widget session
  app.post<{ Body: { token?: string } }>("/public/web/session", { config: { auth: "public", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const now = ctx.clock.now();
    if (req.body?.token) {
      const s = await ctx.db.customerSession.findUnique({ where: { id: sha256(req.body.token) } });
      if (s && s.purpose === "chat" && s.expiresAt > now) return { token: req.body.token, consents: await consentState(ctx, s.customerId) };
    }
    const visitorId = `web-${randomToken(12)}`;
    const { customer } = await resolveCustomer(ctx, "web", visitorId);
    const token = randomToken();
    await ctx.db.customerSession.create({ data: { id: sha256(token), customerId: customer.id, channelCode: "web", purpose: "chat", expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
    return { token, consents: await consentState(ctx, customer.id) };
  });

  app.get("/public/me", { config: { auth: "customer", customerPurpose: "chat" } }, async (req) => {
    const id = req.customer!.customerId;
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id } });
    const convs = await ctx.db.conversation.findMany({ where: { customerId: id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const messages = convs.flatMap((c) => c.messages.map((m) => viewMessage(ctx, m, c.channelCode))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const p = profileOf(ctx, customer);
    return {
      consents: await consentState(ctx, id),
      verified: Boolean(customer.verifiedAt),
      profile: { displayName: p.displayName, programCode: p.programCode, admissionPath: p.admissionPath, stage: p.stage },
      messages: messages.map(({ meta, ...m }) => ({ ...m, citations: meta.citations ?? [], buttons: meta.buttons ?? [], why: meta.why ?? null, promise: meta.promise ?? null })),
    };
  });

  app.post<{ Body: Partial<Record<ConsentPurpose, boolean>> }>("/public/consents", { config: { auth: "customer", customerPurpose: "chat" } }, async (req) => {
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: req.customer!.customerId } });
    const wanted = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => k in CONSENT_PURPOSES)) as Partial<Record<ConsentPurpose, boolean>>;
    return { consents: await setConsents(ctx, customer, "web", wanted) };
  });

  app.post<{ Body: { text?: string } }>("/public/messages", { config: { auth: "customer", customerPurpose: "chat", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!(await hasConsent(ctx, req.customer!.customerId, "service"))) throw new HttpError(403, "consent_required", "Persetujuan layanan diperlukan");
    const text = String(req.body?.text ?? "").slice(0, 4000);
    const r = await receiveInbound(ctx, { channel: "web", externalId: await webExternalId(req.customer!.customerId), text });
    return { ok: true, messageId: r.messageId ?? null };
  });

  app.post<{ Body: { controlId?: string } }>("/public/control", { config: { auth: "customer", customerPurpose: "chat" } }, async (req) => {
    await receiveInbound(ctx, { channel: "web", externalId: await webExternalId(req.customer!.customerId), controlId: String(req.body?.controlId ?? "") });
    return { ok: true };
  });

  /** File completeness check (FR-14). The file is validated in memory and never stored. */
  app.post("/public/files", { config: { auth: "customer", customerPurpose: ["chat", "upload"] } }, async (req) => {
    const id = req.customer!.customerId;
    if (!(await hasConsent(ctx, id, "service"))) throw new HttpError(403, "consent_required", "Persetujuan layanan diperlukan");
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!part) throw new HttpError(400, "no_file", "Berkas tidak ditemukan");
    const docType = String((part.fields.docType as { value?: string } | undefined)?.value ?? "");
    const rule = ctx.config.files.find((r) => r.docType === docType);
    if (!rule) throw new HttpError(400, "unknown_doc_type", "Jenis dokumen tidak dikenal");
    let size = 0;
    for await (const chunk of part.file) size += (chunk as Buffer).length;
    const check = validateFile({ name: part.filename, size, mime: part.mimetype }, rule);
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id } });
    // Result goes back to the channel the link was requested from (web widget or e.g. WhatsApp).
    const conv = await ctx.db.conversation.findFirstOrThrow({ where: { customerId: id, channelCode: req.customer!.channel }, orderBy: { lastActivityAt: "desc" } });
    const { ticket } = await openOrGetTicket(ctx, customer, conv, "persyaratan");
    const action = await ctx.db.aiAction.create({ data: { ticketId: ticket.id, agent: "action", actionType: "file.validate", authorityClass: "allowed", category: "persyaratan", guard: {}, routing: { kind: "answer" }, outcome: "sent", channelCode: conv.channelCode, createdAt: ctx.clock.now(), confidenceComponents: { docType, ok: check.ok, problems: check.problems.length } } });
    const text = check.ok ? `${rule.label} "${part.filename}" memenuhi syarat format dan ukuran. Silakan unggah berkas ini di portal pendaftaran.` : `${rule.label} "${part.filename}" belum memenuhi syarat: ${check.problems.join("; ")}.`;
    await sendOutbound(ctx, { conversation: conv, ticketId: ticket.id, sender: "ai", kind: "file_check", text, aiActionId: action.id, citations: [{ title: "Aturan berkas [DUMMY]", section: rule.label, version: 1 }], customerPseudoId: customer.pseudoId, isDummy: customer.isDummy, tier: ticket.tier, category: "persyaratan" });
    await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "ai_action_executed", ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: conv.channelCode, tier: ticket.tier, category: "persyaratan", actorType: "ai", payload: { aiActionId: action.id, action: "file.validate", ok: check.ok }, isDummy: customer.isDummy });
    return check;
  });

  app.get("/public/upload-info", { config: { auth: "customer", customerPurpose: "upload" } }, async () => ({
    rules: ctx.config.files.map((r) => ({ docType: r.docType, label: r.label, extensions: r.extensions, maxBytes: r.maxBytes })),
  }));

  app.post("/public/data-rights/link", { config: { auth: "customer", customerPurpose: "chat" } }, async (req) => {
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: req.customer!.customerId } });
    return { url: await dataRightsLink(ctx, customer, "web") };
  });

  // ------------------------------------------------------------ data-rights page (FR-65/69)
  app.get("/public/data-rights", { config: { auth: "customer", customerPurpose: "data_rights" } }, async (req) => {
    const id = req.customer!.customerId;
    const c = await ctx.db.customer.findUniqueOrThrow({ where: { id }, include: { identities: true, dsrs: { orderBy: { createdAt: "desc" } } } });
    const p = profileOf(ctx, c);
    return {
      profile: { displayName: p.displayName, regNo: p.regNo, email: p.email, phone: p.phone, programCode: p.programCode, admissionPath: p.admissionPath, stage: p.stage, verified: Boolean(c.verifiedAt) },
      channels: c.identities.map((i) => i.channelCode),
      consents: await consentState(ctx, id),
      purposes: CONSENT_PURPOSES,
      allowedData: ctx.config.allowedData,
      noticeVersion: ctx.config.noticeVersion,
      requests: c.dsrs.map((d) => ({ id: d.id, type: d.type, typeLabel: DSR_TYPES[d.type as DsrType], status: d.status, createdAt: d.createdAt.toISOString() })),
      requestTypes: DSR_TYPES,
    };
  });
  app.post<{ Body: Partial<Record<ConsentPurpose, boolean>> }>("/public/data-rights/consents", { config: { auth: "customer", customerPurpose: "data_rights" } }, async (req) => {
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: req.customer!.customerId } });
    const wanted = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => k in CONSENT_PURPOSES)) as Partial<Record<ConsentPurpose, boolean>>;
    return { consents: await setConsents(ctx, customer, req.customer!.channel, wanted) };
  });
  app.post<{ Body: { type?: string; detail?: string } }>("/public/data-rights/requests", { config: { auth: "customer", customerPurpose: "data_rights" } }, async (req) => {
    const type = String(req.body?.type ?? "");
    if (!(type in DSR_TYPES)) throw new HttpError(400, "invalid_type", "Jenis permintaan tidak dikenal");
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: req.customer!.customerId } });
    const sla = await ctx.params.get<{ unit: string; value: number } | null>("PRM-13");
    const now = ctx.clock.now();
    const due = sla ? (await import("@hk/domain")).computeSlaWindow(now, sla as never, await ctx.params.workCalendar()).deadlineAt : null;
    const dsr = await ctx.db.dataSubjectRequest.create({ data: { customerId: customer.id, type, detailEnc: ctx.crypto.encryptOpt(req.body?.detail?.slice(0, 2000)), dueAt: due, createdAt: now } });
    await appendEvent(ctx.db, { occurredAt: now, type: "dsr_opened", customerPseudoId: customer.pseudoId, channel: req.customer!.channel, actorType: "customer", payload: { dsrId: dsr.id, type, dueAt: due?.toISOString() ?? null, slaParam: sla ? "PRM-13" : "PRM-13 [PERLU DATA]" }, isDummy: customer.isDummy });
    return { id: dsr.id, dueAt: due?.toISOString() ?? null };
  });
  /** Copy of one's own data (right to obtain a copy). Message bodies included: it is their data. */
  app.get("/public/data-rights/export", { config: { auth: "customer", customerPurpose: "data_rights" } }, async (req) => {
    const id = req.customer!.customerId;
    const c = await ctx.db.customer.findUniqueOrThrow({ where: { id }, include: { consents: true, conversations: { include: { messages: true } } } });
    const p = profileOf(ctx, c);
    return {
      exportedAt: ctx.clock.now().toISOString(),
      profile: p,
      consents: c.consents.map((x) => ({ purpose: x.purpose, status: x.status, notice: x.noticeVersion, grantedAt: x.grantedAt, withdrawnAt: x.withdrawnAt })),
      conversations: c.conversations.map((cv) => ({ channel: cv.channelCode, startedAt: cv.startedAt, messages: cv.messages.map((m) => ({ at: m.createdAt, from: m.senderType, text: m.retracted ? "[ditarik]" : ctx.crypto.decrypt(m.bodyEnc) })) })),
    };
  });
}
