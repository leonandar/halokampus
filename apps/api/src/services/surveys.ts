import type { Conversation, Customer, Ticket } from "@hk/db";
import type { Ctx } from "../context.js";
import type { SurveyDef } from "../config.js";
import { appendEvent } from "./ledger.js";
import { latestConversation, sendOutbound } from "./messaging.js";

/**
 * Post-service surveys (FR-57). Items and scales come only from config/surveys/*.yaml;
 * PRM-15 decides which surveys are active. The same message works on every channel:
 * buttons where the channel has them, typed numbers elsewhere.
 */
function active(ctx: Ctx, codes: string[]): SurveyDef[] {
  return ctx.config.surveys.filter((s) => s.kind === "post_service" && codes.includes(s.code) && s.items.length > 0);
}

export async function startSurveys(ctx: Ctx, ticket: Ticket): Promise<number> {
  const cfg = await ctx.params.get<{ surveys: string[] } | null>("PRM-15");
  if (!cfg) return 0;
  const defs = active(ctx, cfg.surveys);
  if (!defs.length) return 0;
  const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: ticket.customerId } });
  const conv = await latestConversation(ctx, customer.id);
  for (const d of defs) {
    const survey = await ctx.db.survey.upsert({ where: { code: d.code }, update: { items: d.items, sourceFile: d.file, active: true }, create: { code: d.code, items: d.items, sourceFile: d.file, active: true } });
    await ctx.db.surveyResponse.create({ data: { surveyId: survey.id, ticketId: ticket.id, channelCode: conv.channelCode, answers: {}, answeredAt: ctx.clock.now(), isDummy: d.dummy || ticket.isDummy } });
  }
  await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "survey_sent", ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: conv.channelCode, tier: ticket.tier, category: ticket.category, payload: { surveys: defs.map((d) => d.code) }, isDummy: ticket.isDummy });
  await askNext(ctx, customer, conv, ticket.id);
  return defs.length;
}

/** Sends the next unanswered item of this ticket's open survey responses. */
async function askNext(ctx: Ctx, customer: Customer, conv: Conversation, ticketId: string): Promise<boolean> {
  // Ask in the order PRM-15 lists the surveys (e.g. CSAT before CES).
  const order = (await ctx.params.get<{ surveys: string[] } | null>("PRM-15"))?.surveys ?? [];
  const open = (await ctx.db.surveyResponse.findMany({ where: { ticketId, completedAt: null }, include: { survey: true } })).sort(
    (a, b) => (order.indexOf(a.survey.code) + 1 || 99) - (order.indexOf(b.survey.code) + 1 || 99),
  );
  for (const r of open) {
    const def = ctx.config.surveys.find((s) => s.code === r.survey.code);
    const answers = r.answers as Record<string, number>;
    const item = def?.items.find((i) => answers[i.id] === undefined);
    if (!def || !item) continue;
    const points = Array.from({ length: item.scale.max - item.scale.min + 1 }, (_, i) => item.scale.min + i);
    const labels = item.scale.minLabel && item.scale.maxLabel ? ` (${item.scale.min} = ${item.scale.minLabel}, ${item.scale.max} = ${item.scale.maxLabel})` : "";
    await sendOutbound(ctx, {
      conversation: conv,
      ticketId,
      sender: "system",
      kind: "system",
      text: `${def.title}: ${item.text}${labels}`,
      buttons: points.map((p) => ({ id: `sv:${r.id}:${item.id}:${p}`, title: String(p) })),
      customerPseudoId: customer.pseudoId,
      isDummy: customer.isDummy,
    });
    return true;
  }
  return false;
}

/** Records one answer (`sv:<responseId>:<itemId>:<value>`), then asks the next item or thanks. */
export async function recordSurveyAnswer(ctx: Ctx, customer: Customer, conv: Conversation, controlId: string): Promise<void> {
  const m = controlId.match(/^sv:([0-9a-f-]{36}):([a-z0-9_-]+):(-?\d+)$/);
  if (!m) return;
  const r = await ctx.db.surveyResponse.findUnique({ where: { id: m[1] }, include: { survey: true } });
  if (!r || r.completedAt || !r.ticketId) return;
  const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id: r.ticketId } });
  if (ticket.customerId !== customer.id) return;
  const def = ctx.config.surveys.find((s) => s.code === r.survey.code);
  const item = def?.items.find((i) => i.id === m[2]);
  const value = Number(m[3]);
  if (!def || !item || value < item.scale.min || value > item.scale.max) return;
  const answers = { ...(r.answers as Record<string, number>), [item.id]: value };
  const done = def.items.every((i) => answers[i.id] !== undefined);
  const now = ctx.clock.now();
  await ctx.db.surveyResponse.update({ where: { id: r.id }, data: { answers, answeredAt: now, completedAt: done ? now : null, channelCode: conv.channelCode } });
  if (done) {
    await appendEvent(ctx.db, { occurredAt: now, type: "survey_answered", ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: conv.channelCode, tier: ticket.tier, category: ticket.category, actorType: "customer", payload: { survey: def.code, answers, scale: item.scale, dummyItems: def.dummy }, isDummy: r.isDummy });
  }
  if (!(await askNext(ctx, customer, conv, ticket.id))) {
    await sendOutbound(ctx, { conversation: conv, ticketId: ticket.id, sender: "system", kind: "system", text: "Terima kasih atas penilaian Kakak.", customerPseudoId: customer.pseudoId, isDummy: customer.isDummy });
  }
}

// =========================================================== usability surveys (FR-58)
/** Usability surveys for staff roles; items only from config/surveys (kind: usability). */
export function usabilitySurveys(ctx: Ctx, role: string) {
  return ctx.config.surveys.filter((s) => s.kind === "usability" && s.audience.includes(role));
}

export async function answerUsability(ctx: Ctx, user: { id: string; role: string }, code: string, answers: Record<string, number>) {
  const def = usabilitySurveys(ctx, user.role).find((s) => s.code === code);
  if (!def) throw Object.assign(new Error("Survei tidak tersedia untuk peran ini"), { status: 404, code: "not_found" });
  for (const i of def.items) {
    const v = Number(answers?.[i.id]);
    if (!Number.isInteger(v) || v < i.scale.min || v > i.scale.max) throw Object.assign(new Error(`Jawaban butir ${i.id} tidak valid`), { status: 400, code: "invalid_answer" });
  }
  const survey = await ctx.db.survey.upsert({ where: { code: def.code }, update: { items: def.items, sourceFile: def.file, active: true }, create: { code: def.code, items: def.items, sourceFile: def.file, active: true } });
  const now = ctx.clock.now();
  const clean = Object.fromEntries(def.items.map((i) => [i.id, Number(answers[i.id])]));
  await ctx.db.surveyResponse.create({ data: { surveyId: survey.id, respondentRole: user.role, respondentUserId: user.id, channelCode: "web", answers: clean, answeredAt: now, completedAt: now, isDummy: def.dummy } });
  await appendEvent(ctx.db, { occurredAt: now, type: "survey_answered", actorType: user.role, actorId: user.id, payload: { survey: def.code, answers: clean, scale: def.items[0]?.scale, dummyItems: def.dummy, respondent: user.role } });
}
