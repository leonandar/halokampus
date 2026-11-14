import { isMandatoryCategory, type Role } from "@hk/shared";
import type { Ctx } from "../context.js";
import { resolveCustomer, setConsents } from "./customers.js";
import { appendAudit, appendEvent } from "./ledger.js";
import { storeInbound } from "./messaging.js";
import { TicketError, escalateTicket, humanEscalate, replyToTicket, resolveTicket, startTimer } from "./tickets.js";

export interface PhoneLogInput {
  callerPhone: string;
  callerName?: string;
  /** The officer read the consent notice and the caller agreed (verbal consent, FR-63). */
  verbalConsent: boolean;
  question: string;
  answer?: string;
  outcome: "resolved" | "open" | "escalate";
  escalateReason?: string;
}

/**
 * Call-centre logging (FR-51). A logged call produces the same conversation, ticket,
 * messages, SLA timer and events as any other channel, so KPI and audit treat it alike.
 * The logging officer owns the ticket from the start (CP → Tier 2, Staf → Tier 3).
 */
export async function logPhoneCall(ctx: Ctx, user: { id: string; role: Role }, input: PhoneLogInput) {
  const phone = String(input.callerPhone ?? "").replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 8) throw new TicketError(400, "invalid_phone", "Nomor penelepon tidak valid");
  if (!input.verbalConsent) throw new TicketError(400, "consent_required", "Persetujuan lisan penelepon wajib dicatat");
  if (!input.question?.trim()) throw new TicketError(400, "question_required", "Isi pertanyaan penelepon wajib dicatat");
  const now = ctx.clock.now();
  const { customer, conversation } = await resolveCustomer(ctx, "phone", phone, input.callerName);
  await setConsents(ctx, customer, "phone", { service: true });

  // Example-based classification is local (no LLM call); rules only while AI is paused on the channel.
  const paused = (await ctx.db.channel.findUnique({ where: { code: "phone" } }))?.aiPaused ?? false;
  const intent = await ctx.intents.classify(input.question, { rulesOnly: paused });
  const tier = user.role === "staff" ? "T3" : "T2";
  const ticket = await ctx.db.ticket.create({
    data: { customerId: customer.id, tier, status: tier === "T3" ? "T3_ACTIVE" : "T2_ACTIVE", category: intent.category, mandatoryCategory: isMandatoryCategory(intent.category), arrivalReason: "PHONE_CALL", assignedUserId: user.id, lastChannelCode: "phone", openedAt: now, isDummy: customer.isDummy },
  });
  await ctx.db.conversation.update({ where: { id: conversation.id }, data: { ticketId: ticket.id } });
  await ctx.db.ticketAssignment.create({ data: { ticketId: ticket.id, userId: user.id, tier, claimedAt: now } });
  const base = { occurredAt: now, ticketId: ticket.id, conversationId: conversation.id, customerPseudoId: customer.pseudoId, channel: "phone", tier, category: intent.category, isDummy: customer.isDummy };
  await appendEvent(ctx.db, { ...base, type: "ticket_opened", payload: { via: "phone_log" } });
  await appendEvent(ctx.db, { ...base, type: "ticket_claimed", actorType: user.role, actorId: user.id });
  await appendEvent(ctx.db, { ...base, type: "handling_started", actorType: user.role, actorId: user.id });
  if (tier === "T3") await startTimer(ctx, ticket, "T3", "resolution", now);
  await storeInbound(ctx, conversation, { text: input.question.trim(), ticketId: ticket.id, customerPseudoId: customer.pseudoId, isDummy: customer.isDummy, meta: { loggedBy: user.id } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.role, action: "phone.log", resourceType: "ticket", resourceId: ticket.id, detail: { verbalConsent: true, outcome: input.outcome } });

  if (input.answer?.trim()) await replyToTicket(ctx, ticket.id, user, input.answer.trim());
  // A CP may not keep a mandatory-category call: it goes to Staf PMB with the log as hand-off.
  if (tier === "T2" && isMandatoryCategory(intent.category)) {
    const t = await ctx.db.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    await escalateTicket(ctx, t, { toTier: "T3", reason: "MANDATORY_CATEGORY", actorType: "system", mandatory: true });
    return { ticketId: ticket.id, tier: "T3", category: intent.category };
  }
  if (input.outcome === "resolved") await resolveTicket(ctx, ticket.id, user);
  if (input.outcome === "escalate") {
    if (tier !== "T2") throw new TicketError(400, "already_t3", "Tiket Staf PMB sudah berada di Tingkat 3");
    await humanEscalate(ctx, ticket.id, user, input.escalateReason ?? "");
  }
  return { ticketId: ticket.id, tier, category: intent.category };
}
