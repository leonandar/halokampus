import { OVERRIDE_CAUSES, OVERRIDE_TYPES, type ChannelCode, type OverrideCause, type OverrideType } from "@hk/shared";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";
import { latestConversation, sendOutbound } from "./messaging.js";
import { actionView } from "./pipeline.js";
import { TicketError } from "./tickets.js";

/**
 * Override of an AI answer/action by Staf PMB (FR-30). Reason and cause are mandatory;
 * the role check happens in the HTTP layer and is repeated here (defence in depth).
 */
export async function overrideAiAction(
  ctx: Ctx,
  args: { aiActionId: string; user: { id: string; role: string }; type: OverrideType; cause: OverrideCause; reason: string; replacement?: string; notifyCustomer: boolean },
) {
  if (args.user.role !== "staff") throw new TicketError(403, "forbidden", "Hanya Staf PMB yang dapat meng-override AI");
  if (!OVERRIDE_TYPES.includes(args.type)) throw new TicketError(400, "invalid_type", "Jenis override tidak dikenal");
  if (!(args.cause in OVERRIDE_CAUSES)) throw new TicketError(400, "invalid_cause", "Kategori penyebab wajib dipilih");
  if (!args.reason?.trim()) throw new TicketError(400, "reason_required", "Alasan override wajib diisi");
  if (args.type !== "cancel" && !args.replacement?.trim()) throw new TicketError(400, "replacement_required", "Teks pengganti/koreksi wajib diisi");
  const action = await ctx.db.aiAction.findUnique({ where: { id: args.aiActionId } });
  if (!action) throw new TicketError(404, "not_found", "Tindakan AI tidak ditemukan");
  if (action.outcome !== "sent") throw new TicketError(409, "not_overridable", "Hanya jawaban/tindakan AI yang sudah terkirim yang dapat di-override");
  const now = ctx.clock.now();
  const ticket = action.ticketId ? await ctx.db.ticket.findUnique({ where: { id: action.ticketId } }) : null;
  const customer = ticket ? await ctx.db.customer.findUniqueOrThrow({ where: { id: ticket.customerId } }) : null;
  const original = await ctx.db.message.findFirst({ where: { aiActionId: action.id, senderType: "ai" } });

  if (original && args.type !== "correct") {
    await ctx.db.message.update({ where: { id: original.id }, data: { retracted: true } });
    if (customer) ctx.realtime.toCustomer(customer.id, "message.retracted", { messageId: original.id });
  }
  if (customer && ticket) {
    const conv = await latestConversation(ctx, customer.id);
    const causeLabel = OVERRIDE_CAUSES[args.cause].toLowerCase();
    let text: string | null = null;
    if (args.type === "replace") text = `${args.notifyCustomer ? `Jawaban sebelumnya diganti oleh Staf PMB (${causeLabel}). ` : ""}${args.replacement!.trim()}`;
    if (args.type === "correct") text = `Koreksi dari Staf PMB: ${args.replacement!.trim()}`;
    if (args.type === "cancel" && args.notifyCustomer) text = `Jawaban Asisten AI sebelumnya ditarik oleh Staf PMB (${causeLabel}). Mohon abaikan jawaban tersebut.`;
    if (text) await sendOutbound(ctx, { conversation: conv, ticketId: ticket.id, sender: "staff", senderUserId: args.user.id, kind: "human_reply", text, customerPseudoId: customer.pseudoId, isDummy: customer.isDummy, tier: ticket.tier, category: ticket.category });
  }
  const ov = await ctx.db.override.create({
    data: { aiActionId: action.id, staffUserId: args.user.id, type: args.type, causeCategory: args.cause, reason: args.reason.trim(), replacementEnc: ctx.crypto.encryptOpt(args.replacement), notifyCustomer: args.notifyCustomer, createdAt: now },
  });
  await ctx.db.aiAction.update({ where: { id: action.id }, data: { outcome: "overridden" } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.user.id, actorRole: "staff", action: "ai.override", resourceType: "ai_action", resourceId: action.id, detail: { overrideId: ov.id, type: args.type, cause: args.cause, ticketId: action.ticketId, notifyCustomer: args.notifyCustomer } });
  await appendEvent(ctx.db, { occurredAt: now, type: "override_applied", ticketId: action.ticketId, customerPseudoId: customer?.pseudoId ?? null, channel: action.channelCode, tier: ticket?.tier ?? null, category: action.category, actorType: "staff", actorId: args.user.id, payload: { aiActionId: action.id, type: args.type, cause: args.cause, confidence: action.confidence === null ? null : Number(action.confidence) }, isDummy: ticket?.isDummy ?? false });
  ctx.realtime.toStaff("ai.action", await actionView(ctx, action.id), { roles: ["staff"] });
  return ov;
}

/** Pause/resume AI per channel or on all channels (FR-31). */
export async function setAiPause(ctx: Ctx, args: { channel: ChannelCode | "all"; paused: boolean; reason: string; user: { id: string; role: string } }) {
  if (args.user.role !== "staff") throw new TicketError(403, "forbidden", "Hanya Staf PMB yang dapat menjeda AI");
  if (args.paused && !args.reason?.trim()) throw new TicketError(400, "reason_required", "Alasan jeda wajib diisi");
  const now = ctx.clock.now();
  const where = args.channel === "all" ? {} : { code: args.channel };
  const res = await ctx.db.channel.updateMany({
    where,
    data: args.paused ? { aiPaused: true, aiPausedReason: args.reason.trim(), aiPausedBy: args.user.id, aiPausedAt: now } : { aiPaused: false, aiPausedReason: null, aiPausedBy: null, aiPausedAt: null },
  });
  if (res.count === 0) throw new TicketError(404, "not_found", "Kanal tidak ditemukan");
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.user.id, actorRole: "staff", action: args.paused ? "ai.pause" : "ai.resume", resourceType: "channel", resourceId: args.channel, detail: { reason: args.reason ?? null } });
  await appendEvent(ctx.db, { occurredAt: now, type: args.paused ? "ai_paused" : "ai_resumed", channel: args.channel === "all" ? null : args.channel, actorType: "staff", actorId: args.user.id, payload: { scope: args.channel } });
  ctx.realtime.toStaff("channels.update", await ctx.db.channel.findMany({ orderBy: { code: "asc" } }));
}
