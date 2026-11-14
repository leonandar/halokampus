import { randomBytes } from "node:crypto";
import type { Prisma } from "@hk/db";
import type { Role } from "@hk/shared";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";
import { kpiReport } from "./kpi.js";
import { TicketError, startTimer } from "./tickets.js";

// =========================================================== QA review (FR-36)
/** Resolved tickets in the period without a review; PRM-16 sets the random sample size. */
export async function qaSample(ctx: Ctx, from: Date, to: Date) {
  const reviewed = new Set((await ctx.db.qaReview.findMany({ select: { ticketId: true } })).map((r) => r.ticketId));
  const resolved = (await ctx.db.ticket.findMany({ where: { resolvedAt: { gte: from, lt: to } }, orderBy: { resolvedAt: "desc" }, select: { id: true, number: true, category: true, lastChannelCode: true, resolvedAt: true, isDummy: true, tier: true } })).filter((t) => !reviewed.has(t.id));
  const rule = await ctx.params.get<{ samplePercent: number } | null>("PRM-16");
  if (!rule) return { items: resolved, rule: null, note: "PRM-16 (aturan sampel QA) [PERLU DATA]: semua kandidat ditampilkan; pilih secara manual." };
  const k = Math.ceil((rule.samplePercent / 100) * resolved.length);
  const shuffled = [...resolved].sort(() => randomBytes(1)[0]! - 128);
  return { items: shuffled.slice(0, k), rule, note: `Sampel acak ${rule.samplePercent}% dari ${resolved.length} tiket selesai.` };
}

export async function submitQaReview(ctx: Ctx, user: { id: string; role: Role }, b: { ticketId: string; scores: Record<string, number>; aiAnswerCorrect: boolean | null; note?: string }) {
  const form = ctx.config.qaForm;
  const t = await ctx.db.ticket.findUnique({ where: { id: b.ticketId } });
  if (!t) throw new TicketError(404, "not_found", "Tiket tidak ditemukan");
  if (await ctx.db.qaReview.findFirst({ where: { ticketId: t.id } })) throw new TicketError(409, "already_reviewed", "Tiket ini sudah dinilai");
  let sum = 0;
  let max = 0;
  for (const c of form.criteria) {
    const v = Number(b.scores?.[c.id]);
    if (!Number.isInteger(v) || v < 0 || v > c.max) throw new TicketError(400, "invalid_score", `Nilai "${c.label}" harus 0–${c.max}`);
    sum += v;
    max += c.max;
  }
  const hasAi = (await ctx.db.aiAction.count({ where: { ticketId: t.id, actionType: "kb.answer", outcome: { in: ["sent", "overridden"] } } })) > 0;
  if (hasAi && typeof b.aiAnswerCorrect !== "boolean") throw new TicketError(400, "ai_judgement_required", "Nilai benar/salah jawaban AI wajib diisi untuk tiket yang memuat jawaban AI");
  const score = Math.round((sum / max) * 10000) / 100;
  const handler = await ctx.db.ticketAssignment.findFirst({ where: { ticketId: t.id }, orderBy: { claimedAt: "desc" } });
  const now = ctx.clock.now();
  const row = await ctx.db.qaReview.create({ data: { ticketId: t.id, reviewerId: user.id, formVersion: form.version, scores: b.scores, scorePercent: score, aiAnswerCorrect: hasAi ? b.aiAnswerCorrect : null, noteEnc: ctx.crypto.encryptOpt(b.note), createdAt: now } });
  await appendEvent(ctx.db, { occurredAt: now, type: "qa_review_submitted", ticketId: t.id, channel: t.lastChannelCode, tier: t.tier, category: t.category, actorType: user.role, actorId: user.id, payload: { score, aiAnswerCorrect: hasAi ? b.aiAnswerCorrect : null, formVersion: form.version, reviewedUserId: handler?.userId ?? "ai" }, isDummy: t.isDummy });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "qa.review", resourceType: "ticket", resourceId: t.id, detail: { score } });
  return row;
}

// =========================================================== CP supervision (FR-34)
export async function cpOverview(ctx: Ctx) {
  const cps = await ctx.db.user.findMany({ where: { roleCode: "cp", active: true }, orderBy: { name: "asc" } });
  const since = new Date(ctx.clock.now().getTime() - 24 * 3600_000);
  const out = [];
  for (const u of cps) {
    const open = await ctx.db.ticket.count({ where: { assignedUserId: u.id, status: { in: ["T2_ACTIVE"] } } });
    const resolved = await ctx.db.event.count({ where: { type: "ticket_resolved", actorId: u.id, occurredAt: { gte: since } } });
    const escalated = await ctx.db.event.count({ where: { type: "escalation", actorId: u.id, occurredAt: { gte: since } } });
    const unread = await ctx.db.cpFeedback.count({ where: { cpUserId: u.id, readAt: null } });
    out.push({ id: u.id, name: u.name, presence: u.presence, openTickets: open, resolved24h: resolved, escalated24h: escalated, unreadFeedback: unread });
  }
  return out;
}

/** Staf takes a ticket back from a CP and puts it in the T2 queue again. */
export async function releaseTicket(ctx: Ctx, ticketId: string, user: { id: string; role: Role }, reason: string) {
  if (!reason?.trim()) throw new TicketError(400, "reason_required", "Alasan wajib diisi");
  const t = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!t || t.status !== "T2_ACTIVE") throw new TicketError(409, "not_active_t2", "Hanya tiket T2 yang sedang ditangani yang dapat dikembalikan ke antrean");
  const now = ctx.clock.now();
  const a = await ctx.db.ticketAssignment.findFirst({ where: { ticketId, releasedAt: null }, include: { user: true } });
  if (a) {
    await ctx.db.ticketAssignment.update({ where: { id: a.id }, data: { releasedAt: now } });
    await appendEvent(ctx.db, { occurredAt: now, type: "handling_ended", ticketId, tier: "T2", category: t.category, channel: t.lastChannelCode, actorType: a.user.roleCode, actorId: a.userId, payload: { by: "release" }, isDummy: t.isDummy });
  }
  await ctx.db.ticket.update({ where: { id: ticketId }, data: { status: "T2_WAITING", assignedUserId: null } });
  await appendEvent(ctx.db, { occurredAt: now, type: "ticket_returned", ticketId, tier: "T2", category: t.category, channel: t.lastChannelCode, actorType: user.role, actorId: user.id, payload: { to: "queue" }, isDummy: t.isDummy });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "ticket.release", resourceType: "ticket", resourceId: ticketId, detail: { reason: reason.trim(), fromUser: a?.userId ?? null } });
  ctx.realtime.toStaff("queue.update", { ticketId, status: "T2_WAITING" });
}

/** Staf returns a Tier-3 ticket to the CP queue (e.g. it needs no staff decision). */
export async function returnToCp(ctx: Ctx, ticketId: string, user: { id: string; role: Role }, reason: string) {
  if (!reason?.trim()) throw new TicketError(400, "reason_required", "Alasan wajib diisi");
  const t = await ctx.db.ticket.findUnique({ where: { id: ticketId } });
  if (!t || !["T3_WAITING", "T3_ACTIVE"].includes(t.status)) throw new TicketError(409, "not_t3", "Hanya tiket Tingkat 3 yang dapat dikembalikan ke Mahasiswa CP");
  if (t.mandatoryCategory) throw new TicketError(409, "mandatory_category", "Kategori wajib harus tetap ditangani Staf PMB");
  const now = ctx.clock.now();
  for (const a of await ctx.db.ticketAssignment.findMany({ where: { ticketId, releasedAt: null }, include: { user: true } })) {
    await appendEvent(ctx.db, { occurredAt: now, type: "handling_ended", ticketId, tier: "T3", category: t.category, channel: t.lastChannelCode, actorType: a.user.roleCode, actorId: a.userId, payload: { by: "return" }, isDummy: t.isDummy });
  }
  await ctx.db.ticketAssignment.updateMany({ where: { ticketId, releasedAt: null }, data: { releasedAt: now } });
  await ctx.db.slaTimer.updateMany({ where: { ticketId, tier: "T3", state: "running" }, data: { state: "cancelled", settledAt: now } });
  const u = await ctx.db.ticket.update({ where: { id: ticketId }, data: { tier: "T2", status: "T2_WAITING", assignedUserId: null, arrivalReason: "STAFF_RETURNED", firstHumanResponseAt: null } });
  const base = { occurredAt: now, ticketId, category: t.category, channel: t.lastChannelCode, actorType: user.role, actorId: user.id, isDummy: t.isDummy };
  await appendEvent(ctx.db, { ...base, type: "ticket_returned", tier: "T2", payload: { from: "T3", to: "T2" } });
  await appendEvent(ctx.db, { ...base, type: "handoff", tier: "T2", payload: { from: "T3", to: "T2" } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "ticket.return_to_cp", resourceType: "ticket", resourceId: ticketId, detail: { reason: reason.trim() } });
  await startTimer(ctx, u, "T2", "response", now);
  ctx.realtime.toStaff("queue.update", { ticketId, tier: "T2", status: "T2_WAITING" });
}

export async function giveCpFeedback(ctx: Ctx, user: { id: string; role: Role }, b: { cpUserId: string; ticketId?: string | null; text: string }) {
  const cp = await ctx.db.user.findUnique({ where: { id: b.cpUserId } });
  if (!cp || cp.roleCode !== "cp") throw new TicketError(404, "not_found", "Mahasiswa CP tidak ditemukan");
  if (!b.text?.trim()) throw new TicketError(400, "text_required", "Isi umpan balik wajib diisi");
  const now = ctx.clock.now();
  const row = await ctx.db.cpFeedback.create({ data: { cpUserId: cp.id, staffUserId: user.id, ticketId: b.ticketId ?? null, textEnc: ctx.crypto.encrypt(b.text.trim()), createdAt: now } });
  await appendEvent(ctx.db, { occurredAt: now, type: "cp_feedback_given", ticketId: b.ticketId ?? null, actorType: user.role, actorId: user.id, payload: { cp: cp.id } });
  return row;
}

// =========================================================== orchestration cycle (FR-35)
interface CycleItem { id: string; fn: string; fnLabel: string; text: string; done: boolean; doneBy: string | null; doneAt: string | null; note: string | null }
interface CycleDoc { items: CycleItem[]; kpiSnapshot?: Record<string, number | null> }

/** Cycle period per PRM-06 (weekly normally, daily in the PRM-18 peak window). */
/** `period_start` is a DATE column: store the WIB calendar date as UTC midnight of that date. */
const asDateColumn = (wibMidnight: Date) => new Date(`${new Date(wibMidnight.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
const fromDateColumn = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00+07:00`);

export async function currentPeriod(ctx: Ctx): Promise<{ cadence: "weekly" | "daily"; start: Date; end: Date; peak: boolean }> {
  const cad = await ctx.params.get<{ normal: "weekly" | "daily"; peak: "weekly" | "daily" }>("PRM-06");
  const peaks = (await ctx.params.get<Array<{ from: string; to: string }> | null>("PRM-18")) ?? [];
  const now = ctx.clock.now();
  const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const peak = peaks.some((p) => today >= p.from && today <= p.to);
  const cadence = peak ? cad.peak : cad.normal;
  const wib = new Date(`${today}T00:00:00+07:00`);
  const start = cadence === "daily" ? wib : new Date(wib.getTime() - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) * 86400_000);
  return { cadence, start, end: new Date(start.getTime() + (cadence === "daily" ? 1 : 7) * 86400_000), peak };
}

export async function currentCycle(ctx: Ctx, create: boolean) {
  const p = await currentPeriod(ctx);
  let c = await ctx.db.orchestrationCycle.findFirst({ where: { cadence: p.cadence, periodStart: asDateColumn(p.start) } });
  if (!c && create) {
    const items: CycleItem[] = ctx.config.orchestration.flatMap((f) => f.items.map((text, i) => ({ id: `${f.id}-${i + 1}`, fn: f.id, fnLabel: f.label, text, done: false, doneBy: null, doneAt: null, note: null })));
    c = await ctx.db.orchestrationCycle.create({ data: { cadence: p.cadence, periodStart: asDateColumn(p.start), checklist: { items } as unknown as Prisma.InputJsonValue } });
  }
  return { period: p, cycle: c };
}

export async function updateCycleItem(ctx: Ctx, user: { id: string; role: Role }, cycleId: string, itemId: string, b: { done: boolean; note?: string }) {
  const c = await ctx.db.orchestrationCycle.findUnique({ where: { id: cycleId } });
  if (!c) throw new TicketError(404, "not_found", "Siklus tidak ditemukan");
  if (c.closedAt) throw new TicketError(409, "closed", "Siklus sudah ditutup");
  const doc = c.checklist as unknown as CycleDoc;
  const item = doc.items.find((i) => i.id === itemId);
  if (!item) throw new TicketError(404, "not_found", "Butir tidak ditemukan");
  const now = ctx.clock.now();
  Object.assign(item, { done: Boolean(b.done), note: b.note?.slice(0, 1000) ?? item.note, doneBy: b.done ? user.id : null, doneAt: b.done ? now.toISOString() : null });
  await ctx.db.orchestrationCycle.update({ where: { id: c.id }, data: { checklist: doc as unknown as Prisma.InputJsonValue, ownerId: c.ownerId ?? user.id } });
  await appendEvent(ctx.db, { occurredAt: now, type: "orchestration_item", actorType: user.role, actorId: user.id, payload: { fn: item.fn, done: item.done } });
  return doc;
}

/** Closing attaches the KPI values of the cycle period ("memantau" → "belajar"). */
export async function closeCycle(ctx: Ctx, user: { id: string; role: Role }, cycleId: string) {
  const c = await ctx.db.orchestrationCycle.findUnique({ where: { id: cycleId } });
  if (!c || c.closedAt) throw new TicketError(409, "not_open", "Siklus tidak ditemukan atau sudah ditutup");
  const start = fromDateColumn(c.periodStart);
  const end = new Date(start.getTime() + (c.cadence === "daily" ? 1 : 7) * 86400_000);
  const r = await kpiReport(ctx, { from: start, to: end, includeDummy: true });
  const doc = c.checklist as unknown as CycleDoc;
  doc.kpiSnapshot = Object.fromEntries(r.kpis.map((k) => [k.id, k.value]));
  const now = ctx.clock.now();
  await ctx.db.orchestrationCycle.update({ where: { id: c.id }, data: { checklist: doc as unknown as Prisma.InputJsonValue, closedAt: now } });
  await appendEvent(ctx.db, { occurredAt: now, type: "orchestration_closed", actorType: user.role, actorId: user.id, payload: { cadence: c.cadence, done: doc.items.filter((i) => i.done).length, total: doc.items.length } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "orchestration.close", resourceType: "orchestration_cycle", resourceId: c.id });
  return doc;
}

// =========================================================== privacy: DSR + retention (FR-65/66)
/** Removes personal data of one customer; events (pseudonymous, no PII) stay for research. */
export async function anonymizeCustomer(ctx: Ctx, customerId: string, reason: string): Promise<void> {
  const now = ctx.clock.now();
  const gone = ctx.crypto.encrypt("[dihapus]");
  const tickets = (await ctx.db.ticket.findMany({ where: { customerId }, select: { id: true } })).map((t) => t.id);
  const convs = (await ctx.db.conversation.findMany({ where: { customerId }, select: { id: true } })).map((c) => c.id);
  await ctx.db.$transaction([
    ctx.db.message.updateMany({ where: { conversationId: { in: convs } }, data: { bodyEnc: gone, meta: {}, providerMessageId: null } }),
    ctx.db.conversation.updateMany({ where: { id: { in: convs } }, data: { state: {}, pendingMessageId: null } }),
    ctx.db.escalation.updateMany({ where: { ticketId: { in: tickets } }, data: { handoffEnc: null, reasonNote: null } }),
    ctx.db.ticket.updateMany({ where: { id: { in: tickets } }, data: { summaryEnc: null } }),
    ctx.db.aiAction.updateMany({ where: { ticketId: { in: tickets } }, data: { outputEnc: null } }),
    ctx.db.customerSession.deleteMany({ where: { customerId } }),
    ctx.db.otp.deleteMany({ where: { customerId } }),
    ctx.db.dataSubjectRequest.updateMany({ where: { customerId }, data: { detailEnc: null } }),
    ctx.db.customer.update({ where: { id: customerId }, data: { displayNameEnc: null, regNoEnc: null, regNoBidx: null, contactEmailEnc: null, contactPhoneEnc: null, programCode: null, admissionPath: null, stage: null, anonymizedAt: now } }),
  ]);
  // Identities are cut loose so a later contact starts a new, unlinked profile.
  for (const i of await ctx.db.customerIdentity.findMany({ where: { customerId } })) {
    await ctx.db.customerIdentity.update({ where: { id: i.id }, data: { externalIdEnc: gone, externalIdBidx: `anon-${randomBytes(12).toString("hex")}` } });
  }
  await appendAudit(ctx.db, { at: now, actorType: "system", action: "customer.anonymize", resourceType: "customer", resourceId: customerId, detail: { reason } });
}

export async function runRetention(ctx: Ctx): Promise<{ anonymized: number; skipped?: string }> {
  const days = await ctx.params.get<number | null>("PRM-08");
  const now = ctx.clock.now();
  if (!days) {
    await appendEvent(ctx.db, { occurredAt: now, type: "retention_run", actorType: "system", payload: { skipped: true, reason: "PRM-08 [PERLU DATA]" } });
    return { anonymized: 0, skipped: "PRM-08 belum ditetapkan" };
  }
  const cutoff = new Date(now.getTime() - days * 86400_000);
  const customers = await ctx.db.customer.findMany({ where: { anonymizedAt: null }, include: { conversations: { select: { lastActivityAt: true } } } });
  let n = 0;
  for (const c of customers) {
    const last = Math.max(c.createdAt.getTime(), ...c.conversations.map((x) => x.lastActivityAt.getTime()));
    if (last >= cutoff.getTime()) continue;
    await anonymizeCustomer(ctx, c.id, `retensi PRM-08 (${days} hari)`);
    n++;
  }
  await appendEvent(ctx.db, { occurredAt: now, type: "retention_run", actorType: "system", payload: { anonymized: n, days } });
  return { anonymized: n };
}

export async function handleDsr(ctx: Ctx, user: { id: string; role: Role }, id: string, b: { status: "in_progress" | "closed" | "rejected"; note?: string; execute?: boolean }) {
  const d = await ctx.db.dataSubjectRequest.findUnique({ where: { id }, include: { customer: true } });
  if (!d) throw new TicketError(404, "not_found", "Permintaan tidak ditemukan");
  if (d.status === "closed" || d.status === "rejected") throw new TicketError(409, "already_closed", "Permintaan sudah ditutup");
  if (!["in_progress", "closed", "rejected"].includes(b.status)) throw new TicketError(400, "invalid_status", "Status tidak dikenal");
  if (b.status !== "in_progress" && !b.note?.trim()) throw new TicketError(400, "note_required", "Catatan penyelesaian wajib diisi");
  const now = ctx.clock.now();
  if (b.status === "closed" && b.execute) {
    if (d.type === "delete") await anonymizeCustomer(ctx, d.customerId, `permintaan hapus ${d.id}`);
    if (d.type === "withdraw") await ctx.db.consent.updateMany({ where: { customerId: d.customerId, status: "granted", purpose: { not: "service" } }, data: { status: "withdrawn", withdrawnAt: now } });
  }
  await ctx.db.dataSubjectRequest.update({ where: { id }, data: { status: b.status, handledBy: user.id, resolutionNoteEnc: ctx.crypto.encryptOpt(b.note), closedAt: b.status === "in_progress" ? null : now } });
  if (b.status !== "in_progress") {
    await appendEvent(ctx.db, { occurredAt: now, type: "dsr_closed", customerPseudoId: d.customer.pseudoId, actorType: user.role, actorId: user.id, payload: { type: d.type, status: b.status, executed: Boolean(b.execute), durationMs: now.getTime() - d.createdAt.getTime(), withinSla: d.dueAt ? now <= d.dueAt : null }, isDummy: d.customer.isDummy });
  }
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "dsr.update", resourceType: "data_subject_request", resourceId: id, detail: { status: b.status, execute: Boolean(b.execute), type: d.type } });
}
