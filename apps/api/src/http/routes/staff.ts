import { draftAgent } from "@hk/ai";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { maskEmail, maskId, maskName, maskPhone } from "@hk/domain";
import { CATEGORIES, CHANNELS, CHANNEL_CAPS, ESCALATION_REASONS, roleHas, type ChannelCode, type Permission } from "@hk/shared";
import { logPhoneCall } from "../../services/phone.js";
import type { Ctx } from "../../context.js";
import { HttpError, requirePermission } from "../auth.js";
import { profileOf } from "../../services/customers.js";
import { appendAudit, appendEvent } from "../../services/ledger.js";
import { viewMessage } from "../../services/messaging.js";
import { retrieve } from "../../services/kb.js";
import { claimTicket, humanEscalate, replyToTicket, resolveTicket, type HandoffPackage } from "../../services/tickets.js";
import type { Ticket } from "@hk/db";

const catLabel = (c: string) => CATEGORIES[c as keyof typeof CATEGORIES]?.label ?? c;

/** Read permission depends on the ticket's tier; finance only sees payment tickets (FR-41). */
async function assertCanRead(ctx: Ctx, req: FastifyRequest, t: Ticket) {
  const perm: Permission = t.tier === "T2" ? "tickets.t2.read" : t.tier === "T3" ? "tickets.t3.read" : "ai.supervise";
  await requirePermission(ctx, req, perm);
  if (req.staff!.role === "finance" && t.category !== "pembayaran") throw new HttpError(403, "forbidden", "Unit keuangan hanya dapat membaca tiket pembayaran");
}

async function assertCanWork(ctx: Ctx, req: FastifyRequest, t: Ticket) {
  await requirePermission(ctx, req, t.tier === "T3" ? "tickets.t3.work" : "tickets.t2.work");
}

export function registerStaffRoutes(app: FastifyInstance, ctx: Ctx) {
  async function queueItems(where: object) {
    const tickets = await ctx.db.ticket.findMany({ where, orderBy: { openedAt: "asc" }, include: { slaTimers: { where: { state: { in: ["running", "breached"] } }, orderBy: { deadlineAt: "asc" } }, customer: true } });
    const users = new Map((await ctx.db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return tickets.map((t) => {
      const timer = t.slaTimers.find((x) => x.tier === t.tier);
      return {
        id: t.id,
        number: t.number,
        tier: t.tier,
        status: t.status,
        category: t.category,
        categoryLabel: catLabel(t.category),
        mandatory: t.mandatoryCategory,
        arrivalReason: t.arrivalReason,
        reasonLabel: t.arrivalReason ? ESCALATION_REASONS[t.arrivalReason as keyof typeof ESCALATION_REASONS] : null,
        channel: t.lastChannelCode,
        customerName: maskName(profileOf(ctx, t.customer).displayName) || "Calon mahasiswa",
        openedAt: t.openedAt.toISOString(),
        assignedUserId: t.assignedUserId,
        assignedName: t.assignedUserId ? users.get(t.assignedUserId) ?? null : null,
        lastConfidence: t.lastConfidence === null ? null : Number(t.lastConfidence),
        sla: timer ? { startsAt: timer.startsAt.toISOString(), deadlineAt: timer.deadlineAt.toISOString(), state: timer.state, paramCode: timer.paramCode } : null,
        isDummy: t.isDummy,
      };
    });
  }

  const chan = (q: { channel?: string }) => (q.channel && (CHANNELS as readonly string[]).includes(q.channel) ? { lastChannelCode: q.channel } : {});

  app.get<{ Querystring: { channel?: string } }>("/api/queue/t2", { config: { auth: "staff", permission: "tickets.t2.read" } }, async (req) => ({ items: await queueItems({ tier: "T2", status: { in: ["T2_WAITING", "T2_ACTIVE"] }, ...chan(req.query) }) }));

  app.get<{ Querystring: { channel?: string } }>("/api/queue/t3", { config: { auth: "staff", permission: "tickets.t3.read" } }, async (req) => {
    const where: Record<string, unknown> = { tier: "T3", status: { in: ["T3_WAITING", "T3_ACTIVE"] }, ...chan(req.query) };
    if (req.staff!.role === "finance") where.category = "pembayaran";
    return { items: await queueItems(where) };
  });

  /** Unified inbox for Staf PMB (FR-55): every human-handled ticket, any tier, any channel. */
  app.get<{ Querystring: { channel?: string } }>("/api/queue/all", { config: { auth: "staff", permission: "tickets.t3.work" } }, async (req) => ({
    items: await queueItems({ status: { in: ["T2_WAITING", "T2_ACTIVE", "T3_WAITING", "T3_ACTIVE"] }, ...chan(req.query) }),
  }));

  app.post<{ Body: Record<string, unknown> }>("/api/phone-calls", { config: { auth: "staff", permission: "phone.log" } }, async (req) => {
    const b = req.body ?? {};
    return logPhoneCall(ctx, req.staff!, {
      callerPhone: String(b.callerPhone ?? ""),
      callerName: b.callerName ? String(b.callerName) : undefined,
      verbalConsent: b.verbalConsent === true,
      question: String(b.question ?? ""),
      answer: b.answer ? String(b.answer) : undefined,
      outcome: (["resolved", "open", "escalate"].includes(String(b.outcome)) ? b.outcome : "open") as "resolved" | "open" | "escalate",
      escalateReason: b.escalateReason ? String(b.escalateReason) : undefined,
    });
  });

  app.get<{ Params: { id: string } }>("/api/tickets/:id", { config: { auth: "staff", permission: "self.read" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id }, include: { customer: true, slaTimers: { orderBy: { triggerAt: "asc" } }, escalations: { orderBy: { createdAt: "desc" } }, aiActions: { orderBy: { createdAt: "desc" }, take: 20 } } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    await assertCanRead(ctx, req, t);
    const p = profileOf(ctx, t.customer);
    const convs = await ctx.db.conversation.findMany({ where: { customerId: t.customerId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    const timeline = convs.flatMap((c) => c.messages.map((m) => viewMessage(ctx, m, c.channelCode))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = t.escalations[0];
    const handoff = latest ? ctx.crypto.decryptJson<HandoffPackage>(latest.handoffEnc) : null;
    return {
      ticket: { id: t.id, number: t.number, tier: t.tier, status: t.status, category: t.category, categoryLabel: catLabel(t.category), mandatory: t.mandatoryCategory, channel: t.lastChannelCode, assignedUserId: t.assignedUserId, openedAt: t.openedAt.toISOString(), firstHumanResponseAt: t.firstHumanResponseAt?.toISOString() ?? null, isDummy: t.isDummy },
      // Masked by the server for every role; unmasking is a separate, audited call (FR-26/67).
      customer: { displayName: maskName(p.displayName), phone: maskPhone(p.phone), email: maskEmail(p.email), regNo: maskId(p.regNo), programCode: p.programCode, admissionPath: p.admissionPath, stage: p.stage, verified: Boolean(t.customer.verifiedAt), channels: convs.map((c) => c.channelCode) },
      handoff,
      escalations: t.escalations.map((e) => ({ id: e.id, from: e.fromTier, to: e.toTier, reason: e.reasonCode, reasonLabel: ESCALATION_REASONS[e.reasonCode as keyof typeof ESCALATION_REASONS] ?? e.reasonCode, note: e.reasonNote, actorType: e.actorType, createdAt: e.createdAt.toISOString() })),
      sla: t.slaTimers.map((s) => ({ tier: s.tier, kind: s.kind, paramCode: s.paramCode, startsAt: s.startsAt.toISOString(), deadlineAt: s.deadlineAt.toISOString(), state: s.state })),
      timeline,
      aiActions: roleHas(req.staff!.role, "ai.supervise") ? t.aiActions.map((a) => ({ id: a.id, actionType: a.actionType, outcome: a.outcome, confidence: a.confidence === null ? null : Number(a.confidence), createdAt: a.createdAt.toISOString() })) : [],
      authority: { canOverride: roleHas(req.staff!.role, "ai.override"), canUnmask: roleHas(req.staff!.role, "customer.pii.unmask") },
      replyChannels: [...new Set(convs.map((c) => c.channelCode))].filter((c) => !CHANNEL_CAPS[c as ChannelCode]?.humanOperated),
    };
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/tickets/:id/unmask", { config: { auth: "staff", permission: "customer.pii.unmask" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    if (!req.body?.reason?.trim()) throw new HttpError(400, "reason_required", "Alasan membuka data pribadi wajib diisi");
    const now = ctx.clock.now();
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: req.staff!.id, actorRole: req.staff!.role, action: "pii_accessed", resourceType: "customer", resourceId: t.customerId, detail: { ticketId: t.id, fields: ["displayName", "phone", "email", "regNo"], reason: req.body.reason.trim() } });
    await appendEvent(ctx.db, { occurredAt: now, type: "pii_accessed", ticketId: t.id, customerPseudoId: t.customer.pseudoId, actorType: req.staff!.role, actorId: req.staff!.id, isDummy: t.isDummy });
    const p = profileOf(ctx, t.customer);
    return { displayName: p.displayName, phone: p.phone, email: p.email, regNo: p.regNo };
  });

  app.post<{ Params: { id: string } }>("/api/tickets/:id/claim", { config: { auth: "staff", permission: "tickets.t2.work" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    await assertCanWork(ctx, req, t);
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: req.staff!.id } });
    const r = await claimTicket(ctx, t.id, { id: user.id, role: req.staff!.role, presence: user.presence });
    return { ok: true, status: r.status };
  });

  app.post<{ Params: { id: string }; Body: { text?: string; draftUsage?: "as_is" | "edited" | "none"; template?: string; channel?: string } }>("/api/tickets/:id/reply", { config: { auth: "staff", permission: "tickets.t2.work" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    await assertCanWork(ctx, req, t);
    const m = await replyToTicket(ctx, t.id, req.staff!, String(req.body?.text ?? ""), { draftUsage: req.body?.draftUsage, template: req.body?.template ?? null, channel: req.body?.channel ?? null });
    return { ok: true, messageId: m.id };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>("/api/tickets/:id/resolve", { config: { auth: "staff", permission: "tickets.t2.work" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    await assertCanWork(ctx, req, t);
    await resolveTicket(ctx, t.id, req.staff!, req.body?.note);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/tickets/:id/escalate", { config: { auth: "staff", permission: "tickets.escalate" } }, async (req) => {
    await humanEscalate(ctx, req.params.id, req.staff!, String(req.body?.reason ?? ""));
    return { ok: true };
  });

  /** AI draft for the human handler (FR-24). The draft is never sent automatically. */
  app.get<{ Params: { id: string } }>("/api/tickets/:id/draft", { config: { auth: "staff", permission: "tickets.t2.work" } }, async (req) => {
    const t = await ctx.db.ticket.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!t) throw new HttpError(404, "not_found", "Tiket tidak ditemukan");
    await assertCanWork(ctx, req, t);
    const lastMsg = await ctx.db.message.findFirst({ where: { ticketId: t.id, senderType: "customer" }, orderBy: { createdAt: "desc" } });
    const question = lastMsg ? ctx.crypto.decrypt(lastMsg.bodyEnc) : "";
    const profile = profileOf(ctx, t.customer);
    const chunks = question ? await retrieve(ctx, question, { profile, k: 3 }) : [];
    const d = await draftAgent(ctx.llm, { summary: ctx.crypto.decryptOpt(t.summaryEnc) ?? "", question, chunks, displayName: profile.displayName });
    return { draft: d.draft, sources: chunks.filter((c) => d.usedChunkIds.includes(c.id)).map((c) => ({ title: c.title, section: c.section, version: c.version })), provider: d.llm?.provider ?? null };
  });

  app.get("/api/templates", { config: { auth: "staff", permission: "tickets.t2.read" } }, async () => ({ templates: ctx.config.templates }));

  app.post<{ Body: { status?: string } }>("/api/presence", { config: { auth: "staff", permission: "presence.set" } }, async (req) => {
    const status = String(req.body?.status ?? "");
    if (!["online", "break", "offline"].includes(status)) throw new HttpError(400, "invalid_status", "Status kehadiran tidak dikenal");
    const now = ctx.clock.now();
    await ctx.db.user.update({ where: { id: req.staff!.id }, data: { presence: status } });
    await ctx.db.presenceLog.create({ data: { userId: req.staff!.id, status, at: now } });
    await appendEvent(ctx.db, { occurredAt: now, type: "presence_changed", actorType: req.staff!.role, actorId: req.staff!.id, payload: { status } });
    return { ok: true, presence: status };
  });
}
