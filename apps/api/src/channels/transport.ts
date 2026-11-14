import type { PrismaClient } from "@hk/db";
import type { ChannelCode } from "@hk/shared";
import { randomToken } from "../crypto.js";

/** Development transport used by every channel simulator (FR-52): writes the provider payload to sim_outbox. */
export async function simulatorSend(db: PrismaClient, channel: ChannelCode, recipient: string, payload: Record<string, unknown>, meta: Record<string, unknown>): Promise<string> {
  const providerMessageId = `sim.${channel}.${randomToken(9)}`;
  await db.simOutbox.create({ data: { channelCode: channel, recipient, payload: { ...payload, _meta: { ...meta, providerMessageId } } as object } });
  return providerMessageId;
}

export type Mode = "simulator" | "live";
