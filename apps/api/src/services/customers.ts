import type { Conversation, Customer, CustomerIdentity } from "@hk/db";
import { CONSENT_PURPOSES, type ChannelCode, type ConsentPurpose } from "@hk/shared";
import type { CustomerProfile } from "@hk/ai";
import type { Ctx } from "../context.js";
import { appendEvent } from "./ledger.js";

export interface ResolvedCustomer {
  customer: Customer;
  identity: CustomerIdentity;
  conversation: Conversation;
  isNew: boolean;
}

/**
 * Finds or creates the customer behind a channel identity and the conversation for it.
 * One conversation per identity; tickets are per customer, so they follow the customer
 * across channels (FR-53/54 basis).
 */
export async function resolveCustomer(ctx: Ctx, channel: ChannelCode, externalId: string, displayName?: string): Promise<ResolvedCustomer> {
  const bidx = ctx.crypto.blindIndex(`${channel}:${externalId}`);
  const now = ctx.clock.now();
  let identity = await ctx.db.customerIdentity.findUnique({ where: { channelCode_externalIdBidx: { channelCode: channel, externalIdBidx: bidx } } });
  let isNew = false;
  let customer: Customer;
  if (!identity) {
    isNew = true;
    customer = await ctx.db.customer.create({
      data: {
        displayNameEnc: ctx.crypto.encryptOpt(displayName),
        contactPhoneEnc: channel === "whatsapp" || channel === "phone" ? ctx.crypto.encrypt(externalId) : null,
        contactEmailEnc: channel === "email" ? ctx.crypto.encrypt(externalId) : null,
        createdAt: now,
        isDummy: ctx.env.ENABLE_SIMULATORS,
      },
    });
    identity = await ctx.db.customerIdentity.create({
      data: { customerId: customer.id, channelCode: channel, externalIdEnc: ctx.crypto.encrypt(externalId), externalIdBidx: bidx, createdAt: now },
    });
  } else {
    customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: identity.customerId } });
  }
  let conversation = await ctx.db.conversation.findFirst({ where: { identityId: identity.id }, orderBy: { startedAt: "desc" } });
  if (!conversation) {
    conversation = await ctx.db.conversation.create({ data: { customerId: customer.id, channelCode: channel, identityId: identity.id, startedAt: now, lastActivityAt: now } });
    await appendEvent(ctx.db, { occurredAt: now, type: "conversation_started", conversationId: conversation.id, customerPseudoId: customer.pseudoId, channel, isDummy: customer.isDummy });
  }
  return { customer, identity, conversation, isNew };
}

export function profileOf(ctx: Ctx, c: Customer): CustomerProfile & { regNo: string | null; email: string | null; phone: string | null } {
  return {
    displayName: ctx.crypto.decryptOpt(c.displayNameEnc),
    programCode: c.programCode,
    admissionPath: c.admissionPath,
    stage: c.stage,
    regNo: ctx.crypto.decryptOpt(c.regNoEnc),
    email: ctx.crypto.decryptOpt(c.contactEmailEnc),
    phone: ctx.crypto.decryptOpt(c.contactPhoneEnc),
  };
}

export async function hasConsent(ctx: Ctx, customerId: string, purpose: ConsentPurpose): Promise<boolean> {
  const c = await ctx.db.consent.findFirst({ where: { customerId, purpose }, orderBy: { grantedAt: "desc" } });
  return c?.status === "granted";
}

export async function consentState(ctx: Ctx, customerId: string): Promise<Record<ConsentPurpose, boolean>> {
  const out = {} as Record<ConsentPurpose, boolean>;
  for (const p of Object.keys(CONSENT_PURPOSES) as ConsentPurpose[]) out[p] = await hasConsent(ctx, customerId, p);
  return out;
}

/** Records consent per purpose (FR-63). Only changed purposes produce rows/events. */
export async function setConsents(ctx: Ctx, customer: Customer, channel: string, wanted: Partial<Record<ConsentPurpose, boolean>>): Promise<Record<ConsentPurpose, boolean>> {
  const now = ctx.clock.now();
  const current = await consentState(ctx, customer.id);
  for (const [purpose, value] of Object.entries(wanted) as Array<[ConsentPurpose, boolean]>) {
    if (!(purpose in CONSENT_PURPOSES) || current[purpose] === value) continue;
    if (value) {
      await ctx.db.consent.create({ data: { customerId: customer.id, purpose, status: "granted", noticeVersion: ctx.config.noticeVersion, channelCode: channel, grantedAt: now } });
      await appendEvent(ctx.db, { occurredAt: now, type: "consent_granted", customerPseudoId: customer.pseudoId, channel, actorType: "customer", payload: { purpose, notice: ctx.config.noticeVersion }, isDummy: customer.isDummy });
    } else {
      await ctx.db.consent.updateMany({ where: { customerId: customer.id, purpose, status: "granted" }, data: { status: "withdrawn", withdrawnAt: now } });
      await appendEvent(ctx.db, { occurredAt: now, type: "consent_withdrawn", customerPseudoId: customer.pseudoId, channel, actorType: "customer", payload: { purpose }, isDummy: customer.isDummy });
    }
  }
  return consentState(ctx, customer.id);
}
