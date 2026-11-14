import { summarizerAgent } from "@hk/ai";
import type { Conversation, Customer, Prisma, Ticket } from "@hk/db";
import { assertTransition, computeSlaWindow, isSlaMet } from "@hk/domain";
import { CATEGORIES, ESCALATION_REASONS, type EscalationReason, type Role, type TicketStatus } from "@hk/shared";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";
import { latestConversation, sendOutbound } from "./messaging.js";
import { profileOf } from "./customers.js";

export class TicketError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const OPEN_STATUSES: TicketStatus[] = ["T1_AI", "T2_WAITING", "T2_ACTIVE", "T3_WAITING", "T3_ACTIVE", "REOPENED"];

// ------------------------------------------------------------------ SLA timers
type TimerKind = "response" | "resolution";

export async function startTimer(ctx: Ctx, ticket: Ticket, tier: "T1" | "T2" | "T3", kind: TimerKind, triggerAt: Date) {
  const paramCode = tier === "T1" ? "PRM-02" : tier === "T2" ? "PRM-03" : ticket.category === "pembayaran" ? "PRM-05" : "PRM-04";
  const duration = await ctx.params.sla(paramCode);
  const calendar = tier === "T2" ? await ctx.params.serviceCalendar() : await ctx.params.workCalendar();
  const w = computeSlaWindow(triggerAt, duration, calendar);
  const versions = await ctx.params.versions([paramCode, "PRM-07", "PRM-19"]);
  const timer = await ctx.db.slaTimer.create({
    data: { ticketId: ticket.id, tier, kind, paramCode, policyVersion: versions[paramCode] ?? 0, triggerAt, startsAt: w.startsAt, deadlineAt: w.deadlineAt },
  });
  await appendEvent(ctx.db, {
    occurredAt: triggerAt,
    type: "sla_started",
    ticketId: ticket.id,
    tier,
    category: ticket.category,
    channel: ticket.lastChannelCode,
    payload: { timerId: timer.id, kind, paramCode, startsAt: w.startsAt.toISOString(), deadlineAt: w.deadlineAt.toISOString() },
    policyVersions: versions,
    isDummy: ticket.isDummy,
  });
  return timer;
}

/** Settles running timers of a tier at `at`: met when at ≤ deadline (inclusive), else breach. */
async function settleTimers(ctx: Ctx, ticket: Ticket, tier: string, kind: TimerKind, at: Date, how: "settle" | "cancel" = "settle") {
  const timers = await ctx.db.slaTimer.findMany({ where: { ticketId: ticket.id, tier, kind, state: "running" } });
  for (const t of timers) {
    const state = how === "cancel" ? "cancelled" : isSlaMet(at, t.deadlineAt) ? "met" : "breached";
    await ctx.db.slaTimer.update({ where: { id: t.id }, data: { state, settledAt: at } });
    if (state === "cancelled") continue;
    await appendEvent(ctx.db, {
      occurredAt: at,
      type: state === "met" ? "sla_met" : "sla_breach",
      ticketId: ticket.id,
      tier,
      category: ticket.category,
      channel: ticket.lastChannelCode,
      payload: { timerId: t.id, kind, paramCode: t.paramCode, deadlineAt: t.deadlineAt.toISOString(), elapsedMs: at.getTime() - t.startsAt.getTime() },
      policyVersions: { [t.paramCode]: t.policyVersion },
      isDummy: ticket.isDummy,
    });
  }
}

/**
 * Periodic SLA sweep (FR-10). Database rows are the source of truth, so a restart of
 * Redis/the worker loses nothing: the next sweep finds every overdue timer.
 */
export async function processDueTimers(ctx: Ctx, now = ctx.clock.now()): Promise<number> {
  const due = await ctx.db.slaTimer.findMany({ where: { state: "running", deadlineAt: { lt: now } }, include: { ticket: true } });
  for (const t of due) {
    const claimed = await ctx.db.slaTimer.updateMany({ where: { id: t.id, state: "running" }, data: { state: "breached", settledAt: now } });
    if (claimed.count === 0) continue;
    await appendEvent(ctx.db, {
      occurredAt: now,
      type: "sla_breach",
      ticketId: t.ticketId,
      tier: t.tier,
      category: t.ticket.category,
      channel: t.ticket.lastChannelCode,
      payload: { timerId: t.id, kind: t.kind, paramCode: t.paramCode, deadlineAt: t.deadlineAt.toISOString(), detectedBy: "sweep" },
      policyVersions: { [t.paramCode]: t.policyVersion },
      isDummy: t.ticket.isDummy,
    });
    const ticket = t.ticket;
    if (t.tier === "T2" && t.kind === "response" && (ticket.status === "T2_WAITING" || ticket.status === "T2_ACTIVE") && !ticket.firstHumanResponseAt) {
      await escalateTicket(ctx, ticket, { toTier: "T3", reason: "SLA_BREACH_T2", actorType: "system" });
    } else {
      ctx.realtime.toStaff("queue.update", { ticketId: ticket.id, slaBreached: true });
    }
  }
  return due.length;
}

// --------------------------------------------------------------------- tickets
export async function findOpenTicket(ctx: Ctx, customerId: string): Promise<Ticket | null> {
  return ctx.db.ticket.findFirst({ where: { customerId, status: { in: OPEN_STATUSES } }, orderBy: { openedAt: "desc" } });
}

/** Returns the customer's open ticket (any channel) or opens a new Tier-1 ticket. */
export async function openOrGetTicket(ctx: Ctx, customer: Customer, conversation: Conversation, category: string): Promise<{ ticket: Ticket; created: boolean }> {
  const now = ctx.clock.now();
  let ticket = await findOpenTicket(ctx, customer.id);
  let created = false;
  if (!ticket) ticket = await reopenRecent(ctx, customer, conversation, now);
  if (!ticket) {
    created = true;
    ticket = await ctx.db.ticket.create({
      data: { customerId: customer.id, tier: "T1", status: "T1_AI", category, lastChannelCode: conversation.channelCode, openedAt: now, isDummy: customer.isDummy },
    });
    await appendEvent(ctx.db, { occurredAt: now, type: "ticket_opened", ticketId: ticket.id, conversationId: conversation.id, customerPseudoId: customer.pseudoId, channel: conversation.channelCode, tier: "T1", category, isDummy: customer.isDummy });
    await startTimer(ctx, ticket, "T1", "response", now);
  } else if (ticket.lastChannelCode !== conversation.channelCode) {
    // Customer switched channel mid-ticket: same ticket, timers untouched (FR-54, KB-05).
    ticket = await ctx.db.ticket.update({ where: { id: ticket.id }, data: { lastChannelCode: conversation.channelCode } });
    ctx.realtime.toStaff("ticket.update", { ticketId: ticket.id, channel: conversation.channelCode });
  }
  if (conversation.ticketId !== ticket.id) await ctx.db.conversation.update({ where: { id: conversation.id }, data: { ticketId: ticket.id } });
  return { ticket, created };
}

/**
 * A customer who writes again within PRM-12 days after resolution reopens the same ticket
 * (KPI: reopen rate, FCR). Without PRM-12 a new ticket is opened instead.
 */
async function reopenRecent(ctx: Ctx, customer: Customer, conversation: Conversation, now: Date): Promise<Ticket | null> {
  const days = await ctx.params.get<number | null>("PRM-12").catch(() => null);
  if (!days) return null;
  const last = await ctx.db.ticket.findFirst({ where: { customerId: customer.id, status: { in: ["RESOLVED", "RESOLVED_AI"] }, resolvedAt: { gte: new Date(now.getTime() - days * 86400_000) } }, orderBy: { resolvedAt: "desc" } });
  if (!last) return null;
  assertTransition(last.status as TicketStatus, "REOPENED");
  const t = await ctx.db.ticket.update({ where: { id: last.id }, data: { status: "T1_AI", tier: "T1", reopenCount: { increment: 1 }, resolvedAt: null, firstResponseAt: null, firstHumanResponseAt: null, negativeFeedbackStreak: 0, assignedUserId: null, lastChannelCode: conversation.channelCode } });
  await appendEvent(ctx.db, { occurredAt: now, type: "ticket_reopened", ticketId: t.id, conversationId: conversation.id, customerPseudoId: customer.pseudoId, channel: conversation.channelCode, tier: "T1", category: t.category, payload: { reopenCount: t.reopenCount, daysWindow: days }, isDummy: t.isDummy });
  await startTimer(ctx, t, "T1", "response", now);
  return t;
}

/**
 * Inactivity sweep (PRM-11 minutes). Tier-1 tickets whose customer went silent are
 * resolved by AI (containment); waiting human tickets whose customer went silent before
 * any human reply are marked abandoned once. Without PRM-11 nothing happens.
 */
export async function processInactivity(ctx: Ctx, now = ctx.clock.now()): Promise<{ resolvedAi: number; abandoned: number }> {
  const minutes = await ctx.params.get<number | null>("PRM-11").catch(() => null);
  if (!minutes) return { resolvedAi: 0, abandoned: 0 };
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  let resolvedAi = 0;
  let abandoned = 0;
  const candidates = await ctx.db.ticket.findMany({ where: { status: { in: ["T1_AI", "T2_WAITING", "T3_WAITING"] } } });
  for (const t of candidates) {
    const lastCustomer = await ctx.db.message.findFirst({ where: { ticketId: t.id, senderType: "customer" }, orderBy: { createdAt: "desc" } });
    if (!lastCustomer || lastCustomer.createdAt > cutoff) continue;
    const base = { occurredAt: now, ticketId: t.id, channel: t.lastChannelCode, tier: t.tier, category: t.category, isDummy: t.isDummy };
    if (t.status === "T1_AI") {
      await ctx.db.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED_AI", resolvedAt: now } });
      await ctx.db.slaTimer.updateMany({ where: { ticketId: t.id, state: "running" }, data: { state: "cancelled", settledAt: now } });
      await appendEvent(ctx.db, { ...base, type: "customer_inactive_timeout", payload: { minutes } });
      await appendEvent(ctx.db, { ...base, type: "ticket_resolved", actorType: "ai", payload: { by: "inactivity", resolutionMs: now.getTime() - t.openedAt.getTime() } });
      resolvedAi++;
    } else if (!t.firstHumanResponseAt && !(await ctx.db.event.findFirst({ where: { ticketId: t.id, type: "customer_inactive_timeout" } }))) {
      await appendEvent(ctx.db, { ...base, type: "customer_inactive_timeout", payload: { minutes, waiting: true } });
      abandoned++;
    }
  }
  return { resolvedAi, abandoned };
}

/** First response of Tier 1 (AI answer or hand-off card) settles the PRM-02 timer. */
export async function markFirstResponse(ctx: Ctx, ticket: Ticket, at: Date) {
  if (ticket.firstResponseAt) return;
  await ctx.db.ticket.update({ where: { id: ticket.id }, data: { firstResponseAt: at } });
  await settleTimers(ctx, ticket, "T1", "response", at);
}

export interface HandoffPackage {
  summary: string;
  customerNeed: string;
  category: string;
  categoryLabel: string;
  reasonCode: EscalationReason;
  reasonLabel: string;
  note?: string | null;
  confidence?: number | null;
  confidenceComponents?: Record<string, unknown> | null;
  channels: Array<{ channel: string; messages: number; lastActivityAt: string }>;
  fromTier: string;
  toTier: string;
}

/** Moves a ticket to Tier 2 or 3 with a full hand-off package (FR-05/08/10/11). */
export async function escalateTicket(
  ctx: Ctx,
  ticketIn: Ticket,
  args: {
    toTier: "T2" | "T3";
    reason: EscalationReason;
    note?: string | null;
    actorType: "ai" | "cp" | "staff" | "system";
    actorUserId?: string | null;
    actorRole?: Role;
    confidence?: number | null;
    confidenceComponents?: Record<string, unknown> | null;
    mandatory?: boolean;
    category?: string;
  },
): Promise<Ticket> {
  const now = ctx.clock.now();
  const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id: ticketIn.id } });
  const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
  const to: TicketStatus = args.toTier === "T2" ? "T2_WAITING" : "T3_WAITING";
  assertTransition(ticket.status as TicketStatus, to);
  const category = args.category ?? ticket.category;

  // Hand-off summary (summarizer agent); no LLM call while AI is paused (FR-20).
  const convs = await ctx.db.conversation.findMany({ where: { customerId: customer.id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  const history = convs
    .flatMap((c) => c.messages.map((m) => ({ at: m.createdAt, sender: m.senderType, body: m.retracted ? "[ditarik]" : ctx.crypto.decrypt(m.bodyEnc) })))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  // No LLM call at all while AI is paused on the channel or unavailable (FR-20, KB-10).
  const channelPaused = (await ctx.db.channel.findUnique({ where: { code: ticket.lastChannelCode } }))?.aiPaused ?? false;
  const aiPaused = channelPaused || args.reason === "AI_PAUSED" || args.reason === "AI_UNAVAILABLE";
  const summary = aiPaused
    ? { summary: `[Tanpa ringkasan AI — ${channelPaused ? "AI dijeda" : ESCALATION_REASONS[args.reason]}] Pesan terakhir: "${[...history].reverse().find((h) => h.sender === "customer")?.body ?? "-"}"`, customerNeed: "" }
    : await summarizerAgent(ctx.llm, { messages: history, category, reason: ESCALATION_REASONS[args.reason], displayName: profileOf(ctx, customer).displayName });

  const handoff: HandoffPackage = {
    summary: summary.summary,
    customerNeed: summary.customerNeed,
    category,
    categoryLabel: CATEGORIES[category as keyof typeof CATEGORIES]?.label ?? category,
    reasonCode: args.reason,
    reasonLabel: ESCALATION_REASONS[args.reason],
    note: args.note ?? null,
    confidence: args.confidence ?? null,
    confidenceComponents: args.confidenceComponents ?? null,
    channels: convs.map((c) => ({ channel: c.channelCode, messages: c.messages.length, lastActivityAt: c.lastActivityAt.toISOString() })),
    fromTier: ticket.tier,
    toTier: args.toTier,
  };

  // Close the previous tier's clocks.
  if (ticket.tier === "T2") await settleTimers(ctx, ticket, "T2", "response", now, "cancel");
  // Close the current handler's handling interval (AHT, occupancy) before the ticket moves on.
  for (const a of await ctx.db.ticketAssignment.findMany({ where: { ticketId: ticket.id, releasedAt: null }, include: { user: true } })) {
    await appendEvent(ctx.db, { occurredAt: now, type: "handling_ended", ticketId: ticket.id, tier: a.tier, category: ticket.category, channel: ticket.lastChannelCode, actorType: a.user.roleCode, actorId: a.userId, payload: { by: "escalation" }, isDummy: ticket.isDummy });
  }
  await ctx.db.ticketAssignment.updateMany({ where: { ticketId: ticket.id, releasedAt: null }, data: { releasedAt: now } });

  const updated = await ctx.db.ticket.update({
    where: { id: ticket.id },
    data: {
      tier: args.toTier,
      status: to,
      category,
      mandatoryCategory: args.mandatory ?? ticket.mandatoryCategory,
      arrivalReason: args.reason,
      assignedUserId: null,
      firstHumanResponseAt: args.toTier === "T3" ? null : ticket.firstHumanResponseAt,
      summaryEnc: ctx.crypto.encrypt(handoff.summary),
      lastConfidence: args.confidence ?? ticket.lastConfidence,
    },
  });
  await ctx.db.escalation.create({
    data: {
      ticketId: ticket.id,
      fromTier: ticket.tier,
      toTier: args.toTier,
      reasonCode: args.reason,
      reasonNote: args.note ?? null,
      handoffEnc: ctx.crypto.encryptJson(handoff),
      confidence: args.confidence ?? null,
      actorType: args.actorType,
      actorUserId: args.actorUserId ?? null,
      createdAt: now,
    },
  });
  const base = { occurredAt: now, ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: ticket.lastChannelCode, category, actorType: args.actorType, actorId: args.actorUserId ?? null, isDummy: ticket.isDummy };
  await appendEvent(ctx.db, { ...base, type: "escalation", tier: args.toTier, payload: { from: ticket.tier, to: args.toTier, reason: args.reason, mandatory: Boolean(args.mandatory), confidence: args.confidence ?? null } });
  if (args.mandatory) await appendEvent(ctx.db, { ...base, type: "escalation_mandatory", tier: args.toTier, payload: { category } });
  await appendEvent(ctx.db, { ...base, type: "handoff", tier: args.toTier, payload: { from: ticket.tier, to: args.toTier } });
  if (args.actorUserId) {
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.actorUserId, actorRole: args.actorRole ?? null, action: "ticket.escalate", resourceType: "ticket", resourceId: ticket.id, detail: { to: args.toTier, reason: args.reason } });
  }

  const timer = await startTimer(ctx, updated, args.toTier, args.toTier === "T2" ? "response" : "resolution", now);

  // Customer-facing hand-off card with a promised time (FR-11).
  const calendar = args.toTier === "T2" ? await ctx.params.serviceCalendar() : await ctx.params.workCalendar();
  const open = calendar.isOpen(now);
  const who = args.toTier === "T2" ? "Mahasiswa CP" : "Staf PMB";
  const promise = open
    ? `Perkiraan tanggapan ${who} paling lambat ${calendar.formatLocal(timer.deadlineAt)}.`
    : `Layanan ${who} buka kembali ${calendar.formatLocal(timer.startsAt)}; tanggapan paling lambat ${calendar.formatLocal(timer.deadlineAt)}. Sementara itu, Asisten AI tetap dapat membantu pertanyaan umum.`;
  const conv = await latestConversation(ctx, customer.id);
  await sendOutbound(ctx, {
    conversation: conv,
    ticketId: ticket.id,
    sender: "system",
    kind: "handoff_card",
    text: `Pertanyaan Kakak sudah diteruskan ke ${who} beserta ringkasan percakapan, jadi Kakak tidak perlu mengulang penjelasan.`,
    promise,
    customerPseudoId: customer.pseudoId,
    isDummy: customer.isDummy,
    tier: args.toTier,
    category,
  });
  await markFirstResponse(ctx, updated, now);
  ctx.realtime.toStaff("queue.update", { ticketId: ticket.id, tier: args.toTier, status: to }, { roles: args.toTier === "T2" ? ["cp", "staff"] : ["staff", "finance"] });
  return updated;
}

// ------------------------------------------------------------- human handling
export async function claimTicket(ctx: Ctx, ticketId: string, user: { id: string; role: Role; presence: string }) {
  const now = ctx.clock.now();
  const ticket = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new TicketError(404, "not_found", "Tiket tidak ditemukan");
  const waiting = ticket.tier === "T2" ? "T2_WAITING" : ticket.tier === "T3" ? "T3_WAITING" : null;
  if (!waiting) throw new TicketError(409, "not_claimable", "Tiket tidak berada di antrean manusia");
  if (ticket.tier === "T3" && user.role !== "staff") throw new TicketError(403, "forbidden_tier", "Tiket Tingkat 3 hanya untuk Staf PMB");
  if (user.role === "cp" && user.presence !== "online") throw new TicketError(409, "not_online", "Ubah status menjadi online sebelum mengklaim tiket");
  const active = waiting === "T2_WAITING" ? "T2_ACTIVE" : "T3_ACTIVE";
  // Atomic claim: only one person can win (FR-21).
  const res = await ctx.db.ticket.updateMany({ where: { id: ticketId, status: waiting, assignedUserId: null }, data: { status: active, assignedUserId: user.id } });
  if (res.count !== 1) throw new TicketError(409, "already_claimed", "Tiket sudah diklaim petugas lain");
  await ctx.db.ticketAssignment.create({ data: { ticketId, userId: user.id, tier: ticket.tier, claimedAt: now } });
  const base = { occurredAt: now, ticketId, tier: ticket.tier, category: ticket.category, channel: ticket.lastChannelCode, actorType: user.role, actorId: user.id, isDummy: ticket.isDummy };
  await appendEvent(ctx.db, { ...base, type: "ticket_claimed" });
  await appendEvent(ctx.db, { ...base, type: "handling_started" });
  ctx.realtime.toStaff("queue.update", { ticketId, status: active, assignedUserId: user.id });
  return ctx.db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
}

function assertHandler(ticket: Ticket, user: { id: string }) {
  if (ticket.assignedUserId !== user.id) throw new TicketError(409, "not_assignee", "Klaim tiket ini terlebih dahulu");
}

export async function replyToTicket(ctx: Ctx, ticketId: string, user: { id: string; role: Role }, text: string, meta: { draftUsage?: "as_is" | "edited" | "none"; template?: string | null; channel?: string | null } = {}) {
  const ticket = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new TicketError(404, "not_found", "Tiket tidak ditemukan");
  assertHandler(ticket, user);
  if (!text.trim()) throw new TicketError(400, "empty", "Pesan kosong");
  const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
  // Unified inbox (FR-55): reply on the channel the officer picks, default = last used.
  const conv = meta.channel
    ? await ctx.db.conversation.findFirst({ where: { customerId: customer.id, channelCode: meta.channel }, orderBy: { lastActivityAt: "desc" } })
    : await latestConversation(ctx, customer.id);
  if (!conv) throw new TicketError(400, "no_channel", "Calon mahasiswa belum pernah memakai kanal itu");
  const now = ctx.clock.now();
  const msg = await sendOutbound(ctx, {
    conversation: conv,
    ticketId,
    sender: user.role === "cp" ? "cp" : "staff",
    senderUserId: user.id,
    kind: "human_reply",
    text: text.trim(),
    customerPseudoId: customer.pseudoId,
    isDummy: customer.isDummy,
    tier: ticket.tier,
    category: ticket.category,
  });
  if (!ticket.firstHumanResponseAt) {
    await ctx.db.ticket.update({ where: { id: ticketId }, data: { firstHumanResponseAt: now } });
    const esc = await ctx.db.escalation.findFirst({ where: { ticketId }, orderBy: { createdAt: "desc" } });
    await appendEvent(ctx.db, {
      occurredAt: now,
      type: "first_human_response",
      ticketId,
      tier: ticket.tier,
      category: ticket.category,
      channel: conv.channelCode,
      actorType: user.role,
      actorId: user.id,
      payload: { waitMs: esc ? now.getTime() - esc.createdAt.getTime() : null, draftUsage: meta.draftUsage ?? "none", template: meta.template ?? null },
      isDummy: ticket.isDummy,
    });
    if (ticket.tier === "T2") await settleTimers(ctx, ticket, "T2", "response", now);
  }
  return msg;
}

export async function resolveTicket(ctx: Ctx, ticketId: string, user: { id: string; role: Role }, note?: string) {
  const ticket = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new TicketError(404, "not_found", "Tiket tidak ditemukan");
  assertHandler(ticket, user);
  assertTransition(ticket.status as TicketStatus, "RESOLVED");
  const now = ctx.clock.now();
  await settleTimers(ctx, ticket, ticket.tier, ticket.tier === "T3" ? "resolution" : "response", now, ticket.tier === "T3" ? "settle" : "cancel");
  await ctx.db.ticket.update({ where: { id: ticketId }, data: { status: "RESOLVED", resolvedAt: now } });
  await ctx.db.ticketAssignment.updateMany({ where: { ticketId, releasedAt: null }, data: { releasedAt: now } });
  const base = { occurredAt: now, ticketId, tier: ticket.tier, category: ticket.category, channel: ticket.lastChannelCode, actorType: user.role, actorId: user.id, isDummy: ticket.isDummy };
  await appendEvent(ctx.db, { ...base, type: "handling_ended" });
  await appendEvent(ctx.db, { ...base, type: "ticket_resolved", payload: { resolutionMs: now.getTime() - ticket.openedAt.getTime(), hasNote: Boolean(note) } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "ticket.resolve", resourceType: "ticket", resourceId: ticketId });
  ctx.realtime.toStaff("queue.update", { ticketId, status: "RESOLVED" });
  // Post-service CSAT/CES on the customer's last channel (FR-57). Not for phone logs: the officer asks verbally.
  if (ticket.lastChannelCode !== "phone") await (await import("./surveys.js")).startSurveys(ctx, { ...ticket, status: "RESOLVED" });
}

export async function humanEscalate(ctx: Ctx, ticketId: string, user: { id: string; role: Role }, reason: string) {
  if (!reason?.trim()) throw new TicketError(400, "reason_required", "Alasan eskalasi wajib diisi");
  const ticket = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new TicketError(404, "not_found", "Tiket tidak ditemukan");
  if (ticket.tier !== "T2") throw new TicketError(409, "not_t2", "Hanya tiket Tingkat 2 yang dapat dieskalasi ke Staf PMB");
  assertHandler(ticket, user);
  return escalateTicket(ctx, ticket, { toTier: "T3", reason: "CP_ESCALATED", note: reason.trim(), actorType: user.role === "cp" ? "cp" : "staff", actorUserId: user.id, actorRole: user.role });
}

export type { Prisma };
