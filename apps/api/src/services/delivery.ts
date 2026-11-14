import type { Ctx } from "../context.js";
import type { StatusItem } from "../channels/whatsapp.js";

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Applies provider delivery/read receipts (FR-44). Status only moves forward. */
export async function applyDeliveryStatuses(ctx: Ctx, items: StatusItem[]): Promise<number> {
  let n = 0;
  for (const s of items) {
    const m = await ctx.db.message.findFirst({ where: { providerMessageId: s.providerMessageId } });
    if (!m || (RANK[s.status] ?? 0) <= (RANK[m.deliveryStatus] ?? 0)) continue;
    await ctx.db.message.update({ where: { id: m.id }, data: { deliveryStatus: s.status } });
    if (m.ticketId) ctx.realtime.toStaff("ticket.message.status", { ticketId: m.ticketId, messageId: m.id, status: s.status });
    n++;
  }
  return n;
}
