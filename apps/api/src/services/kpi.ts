import { computeKpis, type KpiEvent, type KpiFilter, type KpiResult } from "@hk/kpi";
import type { Ctx } from "../context.js";

export interface KpiQuery extends KpiFilter {
  includeDummy: boolean;
}

const LOOKBACK_DAYS = 60; // tickets opened up to 60 days before `from` (backlog, ASA of late answers)

/**
 * Loads exactly the events the KPI engine needs (FR-59/60): every event of tickets opened
 * in [from − 60 d, to), plus all events that occurred in [from − 7 d, to) (presence, QA,
 * surveys, DSR…). The engine itself applies the period and filters.
 */
export async function loadKpiEvents(ctx: Ctx, q: KpiQuery): Promise<KpiEvent[]> {
  const lookback = new Date(q.from.getTime() - LOOKBACK_DAYS * 86400_000);
  const recent = new Date(q.from.getTime() - 7 * 86400_000);
  // Sub-select instead of an id list: a peak month exceeds PostgreSQL's 32 767 bind-parameter limit.
  const rows = await ctx.db.$queryRaw<Array<{ seq: bigint; occurred_at: Date; type: string; ticket_id: string | null; channel: string | null; tier: string | null; category: string | null; actor_type: string | null; actor_id: string | null; payload: Record<string, unknown>; customer_pseudo_id: string | null }>>`
    SELECT seq, occurred_at, type, ticket_id, channel, tier, category, actor_type, actor_id, payload, customer_pseudo_id
      FROM events e
     WHERE (${q.includeDummy} OR e.is_dummy = false)
       AND ((e.occurred_at >= ${recent} AND e.occurred_at < ${q.to})
            OR e.ticket_id IN (SELECT o.ticket_id FROM events o
                                WHERE o.type = 'ticket_opened' AND o.occurred_at >= ${lookback} AND o.occurred_at < ${q.to}))
     ORDER BY e.seq`;
  return rows.map((r) => ({
    seq: r.seq,
    occurredAt: r.occurred_at,
    type: r.type,
    ticketId: r.ticket_id,
    channel: r.channel,
    tier: r.tier,
    category: r.category,
    actorType: r.actor_type,
    actorId: r.actor_id,
    payload: r.payload ?? {},
    customerPseudoId: r.customer_pseudo_id,
  }));
}

export interface KpiReport extends KpiResult {
  period: { from: string; to: string };
  filters: Omit<KpiQuery, "from" | "to">;
  params: { PRM01: number; PRM11: number | null; PRM12: number | null; targets: Record<string, number> };
  kpiMap: Record<string, string | null>;
  agents: Record<string, string>;
  containsDummy: boolean;
  generatedAt: string;
}

export async function kpiReport(ctx: Ctx, qIn: KpiQuery): Promise<KpiReport> {
  // A period that has not ended yet is measured up to "now" (occupancy, backlog age).
  const now = ctx.clock.now();
  const nowEnd = new Date(now.getTime() + 1); // `to` is exclusive; include events stamped exactly now
  const q = { ...qIn, to: qIn.to > nowEnd && qIn.from < now ? nowEnd : qIn.to };
  const events = await loadKpiEvents(ctx, q);
  const params = {
    reopenWindowDays: await ctx.params.get<number | null>("PRM-12"),
    abandonMinutes: await ctx.params.get<number | null>("PRM-11"),
    confidenceThreshold: await ctx.params.confidenceThreshold(),
    targets: (await ctx.params.get<Record<string, number>>("PRM-14")) ?? {},
    timezone: (await ctx.params.get<{ timezone: string }>("PRM-07")).timezone,
  };
  const result = computeKpis(events, q, params);
  const users = await ctx.db.user.findMany({ select: { id: true, name: true } });
  const containsDummy = q.includeDummy && (await ctx.db.event.count({ where: { isDummy: true, occurredAt: { gte: q.from, lt: q.to } } })) > 0;
  return {
    ...result,
    period: { from: q.from.toISOString(), to: q.to.toISOString() },
    filters: { includeDummy: q.includeDummy, channel: q.channel, category: q.category, tier: q.tier, agentId: q.agentId },
    params: { PRM01: params.confidenceThreshold, PRM11: params.abandonMinutes, PRM12: params.reopenWindowDays, targets: params.targets },
    kpiMap: ctx.config.kpiMap,
    agents: Object.fromEntries(users.map((u) => [u.id, u.name])),
    containsDummy,
    generatedAt: ctx.clock.now().toISOString(),
  };
}

/** Parses ?from=YYYY-MM-DD&to=YYYY-MM-DD as WIB calendar days (to inclusive). Default: last 7 days. */
export function parsePeriod(ctx: Ctx, from?: string, to?: string): { from: Date; to: Date } {
  const day = (s: string) => new Date(`${s}T00:00:00+07:00`);
  const now = ctx.clock.now();
  const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(day(to).getTime() + 86400_000) : new Date(Math.ceil((now.getTime() + 7 * 3600_000) / 86400_000) * 86400_000 - 7 * 3600_000);
  const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? day(from) : new Date(toD.getTime() - 7 * 86400_000);
  if (!(fromD < toD)) throw Object.assign(new Error("Periode tidak valid"), { status: 400, code: "invalid_period" });
  if (toD.getTime() - fromD.getTime() > 400 * 86400_000) throw Object.assign(new Error("Periode maksimal 400 hari"), { status: 400, code: "period_too_long" });
  return { from: fromD, to: toD };
}
