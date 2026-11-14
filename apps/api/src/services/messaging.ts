import type { Conversation, Message, Prisma } from "@hk/db";
import type { ChannelCode } from "@hk/shared";
import type { Ctx } from "../context.js";
import type { OutboundMessage } from "../channels/types.js";
import { appendEvent } from "./ledger.js";

export type SenderType = "customer" | "ai" | "cp" | "staff" | "system";

const SENDER_LABEL: Record<SenderType, string> = {
  customer: "Anda",
  ai: "Asisten AI haloK@MPUS",
  cp: "Mahasiswa CP",
  staff: "Staf PMB",
  system: "haloK@MPUS",
};

export interface StoredMessageView {
  id: string;
  ticketId: string | null;
  conversationId: string;
  channel: string;
  senderType: string;
  senderLabel: string;
  kind: string;
  text: string;
  meta: Record<string, unknown>;
  aiActionId: string | null;
  retracted: boolean;
  deliveryStatus: string;
  createdAt: string;
}

export function viewMessage(ctx: Ctx, m: Message, channel: string): StoredMessageView {
  return {
    id: m.id,
    ticketId: m.ticketId,
    conversationId: m.conversationId,
    channel,
    senderType: m.senderType,
    senderLabel: SENDER_LABEL[m.senderType as SenderType] ?? m.senderType,
    kind: m.kind,
    text: m.retracted ? "[Pesan ini ditarik oleh Staf PMB]" : ctx.crypto.decrypt(m.bodyEnc),
    meta: m.meta as Record<string, unknown>,
    aiActionId: m.aiActionId,
    retracted: m.retracted,
    deliveryStatus: m.deliveryStatus,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Stores an inbound customer message and notifies the consoles. */
export async function storeInbound(ctx: Ctx, conv: Conversation, args: { text: string; ticketId: string | null; meta?: Record<string, unknown>; customerPseudoId: string; isDummy: boolean }) {
  const now = ctx.clock.now();
  const m = await ctx.db.message.create({
    data: { conversationId: conv.id, ticketId: args.ticketId, senderType: "customer", kind: "text", bodyEnc: ctx.crypto.encrypt(args.text), meta: (args.meta ?? {}) as Prisma.InputJsonValue, createdAt: now, isDummy: args.isDummy },
  });
  await ctx.db.conversation.update({ where: { id: conv.id }, data: { lastActivityAt: now } });
  await appendEvent(ctx.db, { occurredAt: now, type: "message_received", ticketId: args.ticketId, conversationId: conv.id, customerPseudoId: args.customerPseudoId, channel: conv.channelCode, actorType: "customer", payload: { messageId: m.id, length: args.text.length }, isDummy: args.isDummy });
  if (args.ticketId) ctx.realtime.toStaff("ticket.message", { ticketId: args.ticketId, message: viewMessage(ctx, m, conv.channelCode) });
  return m;
}

/**
 * Stores an outbound message and delivers it on the customer's channel. When a ticket
 * is attached, the reply goes to the conversation the customer used last (continuity).
 */
export async function sendOutbound(
  ctx: Ctx,
  args: {
    conversation: Conversation;
    ticketId: string | null;
    sender: SenderType;
    senderUserId?: string | null;
    kind: OutboundMessage["kind"];
    text: string;
    citations?: OutboundMessage["citations"];
    buttons?: OutboundMessage["buttons"];
    why?: string;
    promise?: string;
    aiActionId?: string | null;
    customerPseudoId: string;
    isDummy: boolean;
    tier?: string | null;
    category?: string | null;
  },
): Promise<Message> {
  const now = ctx.clock.now();
  const meta = { citations: args.citations, buttons: args.buttons, why: args.why, promise: args.promise };
  const m = await ctx.db.message.create({
    data: {
      conversationId: args.conversation.id,
      ticketId: args.ticketId,
      senderType: args.sender,
      senderUserId: args.senderUserId ?? null,
      kind: args.kind,
      bodyEnc: ctx.crypto.encrypt(args.text),
      meta: JSON.parse(JSON.stringify(meta)) as Prisma.InputJsonValue,
      aiActionId: args.aiActionId ?? null,
      createdAt: now,
      isDummy: args.isDummy,
    },
  });
  await ctx.db.conversation.update({ where: { id: args.conversation.id }, data: { lastActivityAt: now } });
  await appendEvent(ctx.db, {
    occurredAt: now,
    type: "message_sent",
    ticketId: args.ticketId,
    conversationId: args.conversation.id,
    customerPseudoId: args.customerPseudoId,
    channel: args.conversation.channelCode,
    tier: args.tier ?? null,
    category: args.category ?? null,
    actorType: args.sender,
    actorId: args.senderUserId ?? null,
    payload: { messageId: m.id, kind: args.kind },
    isDummy: args.isDummy,
  });
  const identity = args.conversation.identityId ? await ctx.db.customerIdentity.findUnique({ where: { id: args.conversation.identityId } }) : null;
  const adapter = ctx.channels[args.conversation.channelCode as ChannelCode];
  if (adapter && identity) {
    const out: OutboundMessage = {
      messageId: m.id,
      kind: args.kind,
      text: args.text,
      senderLabel: SENDER_LABEL[args.sender],
      citations: args.citations,
      buttons: args.buttons,
      why: args.why,
      promise: args.promise,
      aiActionId: args.aiActionId ?? undefined,
      createdAt: now.toISOString(),
    };
    try {
      const r = await adapter.send({ customerId: args.conversation.customerId, externalId: ctx.crypto.decrypt(identity.externalIdEnc) }, out);
      if (r?.providerMessageId) await ctx.db.message.update({ where: { id: m.id }, data: { providerMessageId: r.providerMessageId } });
      // Channels without (enough) buttons get typed options; remember how to map the reply.
      const conv = await ctx.db.conversation.findUniqueOrThrow({ where: { id: args.conversation.id } });
      const state = (conv.state ?? {}) as Record<string, unknown>;
      if (r?.textOptions) await ctx.db.conversation.update({ where: { id: conv.id }, data: { state: { ...state, options: r.textOptions } } });
      else if (state.options && args.buttons?.length) await ctx.db.conversation.update({ where: { id: conv.id }, data: { state: { ...state, options: undefined } as object } });
    } catch (e) {
      await ctx.db.message.update({ where: { id: m.id }, data: { deliveryStatus: "failed" } });
      console.error(`[messaging] delivery failed on ${args.conversation.channelCode}: ${(e as Error).message}`);
    }
  }
  if (args.ticketId) ctx.realtime.toStaff("ticket.message", { ticketId: args.ticketId, message: viewMessage(ctx, m, args.conversation.channelCode) });
  return m;
}

/** Conversation the customer used most recently for a ticket (or any of theirs). */
export async function latestConversation(ctx: Ctx, customerId: string): Promise<Conversation> {
  return ctx.db.conversation.findFirstOrThrow({ where: { customerId }, orderBy: { lastActivityAt: "desc" } });
}
