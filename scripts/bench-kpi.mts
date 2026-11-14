/**
 * KPI engine benchmark for one peak week (NFR-03): 5 000 tickets/day × 7 days of synthetic
 * events (no database). Shows whether computing KPIs on demand (ADR-16) is fast enough.
 */
import { writeFileSync } from "node:fs";
import { computeKpis, type KpiEvent } from "@hk/kpi";

const PER_DAY = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 5000);
const DAYS = 7;
const start = Date.parse("2027-01-25T00:00:00Z");
const events: KpiEvent[] = [];
let seq = 0;
const ch = ["web", "whatsapp", "instagram", "messenger", "telegram", "email"];
const ev = (type: string, t: number, ticketId: string | null, x: Partial<KpiEvent> = {}): KpiEvent => ({ seq: ++seq, occurredAt: new Date(t), type, ticketId, channel: null, tier: null, category: null, actorType: null, actorId: null, payload: {}, ...x });
for (let d = 0; d < DAYS; d++) {
  for (let i = 0; i < PER_DAY; i++) {
    const id = `t${d}-${i}`;
    const t0 = start + d * 86400_000 + Math.floor((i / PER_DAY) * 86400_000);
    const channel = ch[i % ch.length]!;
    const base = { channel, category: i % 10 === 0 ? "pembayaran" : "info_umum" };
    events.push(ev("ticket_opened", t0, id, { ...base, tier: "T1" }), ev("message_received", t0, id, base));
    if (i % 10 === 0) {
      events.push(ev("escalation", t0 + 1000, id, { ...base, tier: "T3", actorType: "ai", payload: { from: "T1", to: "T3", mandatory: true } }), ev("escalation_mandatory", t0 + 1000, id, base), ev("handoff", t0 + 1000, id, { payload: { from: "T1", to: "T3" } }), ev("sla_met", t0 + 1000, id, { ...base, tier: "T1", payload: { paramCode: "PRM-02" } }));
      events.push(ev("handling_started", t0 + 600_000, id, { ...base, tier: "T3", actorId: "s1" }), ev("first_human_response", t0 + 660_000, id, { ...base, tier: "T3", actorId: "s1" }), ev("message_sent", t0 + 660_000, id, { ...base, actorType: "staff" }), ev("handling_ended", t0 + 3_600_000, id, { ...base, tier: "T3", actorId: "s1" }), ev("ticket_resolved", t0 + 3_600_000, id, base), ev("sla_met", t0 + 3_600_000, id, { ...base, tier: "T3", payload: { paramCode: "PRM-05" } }));
    } else if (i % 3 === 0) {
      events.push(ev("escalation", t0 + 2000, id, { ...base, tier: "T2", actorType: "ai", payload: { from: "T1", to: "T2", confidence: 0.6 } }), ev("handoff", t0 + 2000, id, { payload: { from: "T1", to: "T2" } }), ev("sla_met", t0 + 2000, id, { ...base, tier: "T1", payload: { paramCode: "PRM-02" } }));
      events.push(ev("handling_started", t0 + 60_000, id, { ...base, tier: "T2", actorId: `cp${i % 20}` }), ev("first_human_response", t0 + 120_000, id, { ...base, tier: "T2", actorId: `cp${i % 20}` }), ev("message_sent", t0 + 120_000, id, { ...base, actorType: "cp" }), ev("sla_met", t0 + 120_000, id, { ...base, tier: "T2", payload: { paramCode: "PRM-03" } }), ev("handling_ended", t0 + 400_000, id, { ...base, tier: "T2", actorId: `cp${i % 20}` }), ev("ticket_resolved", t0 + 400_000, id, base));
      events.push(ev("survey_answered", t0 + 500_000, id, { ...base, payload: { survey: "csat", answers: { a: 1 + (i % 5) }, scale: { min: 1, max: 5 } } }));
    } else {
      events.push(ev("message_sent", t0 + 1500, id, { ...base, actorType: "ai" }), ev("ai_answer_sent", t0 + 1500, id, { ...base, tier: "T1", payload: { confidence: 0.8 + (i % 20) / 100, latencyMs: 1200 } }), ev("sla_met", t0 + 1500, id, { ...base, tier: "T1", payload: { paramCode: "PRM-02" } }));
    }
  }
}
const params = { reopenWindowDays: 7, abandonMinutes: 30, confidenceThreshold: 0.75, targets: {} };
const filter = { from: new Date(start), to: new Date(start + DAYS * 86400_000) };
const runs: number[] = [];
let r = computeKpis(events, filter, params);
for (let k = 0; k < 3; k++) {
  const t = performance.now();
  r = computeKpis(events, filter, params);
  runs.push(performance.now() - t);
}
const tChannel = performance.now();
computeKpis(events, { ...filter, channel: "whatsapp" }, params);
const out = {
  ticketsPerDay: PER_DAY,
  days: DAYS,
  tickets: r.ticketCount,
  events: events.length,
  computeMs: { min: Math.round(Math.min(...runs)), max: Math.round(Math.max(...runs)) },
  computeWithChannelFilterMs: Math.round(performance.now() - tChannel),
  heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
  sample: Object.fromEntries(r.kpis.filter((k) => ["containment", "esc_t2", "esc_t3", "frt", "asa"].includes(k.id)).map((k) => [k.id, k.value])),
};
writeFileSync("docs/bench-kpi-result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));

// ---- optional: same week through PostgreSQL (`pnpm bench:kpi -- 5000 --db`)
if (process.argv.includes("--db")) {
  const { PrismaClient } = await import("@hk/db");
  const { readFileSync } = await import("node:fs");
  const { loadKpiEvents } = await import("../apps/api/src/services/kpi.js");
  const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  const url = env.DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, "/halokampus_load$1");
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe(`TRUNCATE "events" RESTART IDENTITY`);
  const uuid = (s: string) => {
    const h = Buffer.from(s).toString("hex").padEnd(32, "0").slice(0, 32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const ids = new Map<string, string>();
  const idOf = (t: string | null) => (t ? ids.get(t) ?? ids.set(t, crypto.randomUUID()).get(t)! : null);
  const t0 = performance.now();
  for (let i = 0; i < events.length; i += 5000) {
    await db.event.createMany({
      data: events.slice(i, i + 5000).map((e, j) => ({ occurredAt: e.occurredAt, type: e.type, ticketId: idOf(e.ticketId), channel: e.channel, tier: e.tier, category: e.category, actorType: e.actorType, actorId: e.actorId, payload: e.payload, isDummy: true, prevHash: "bench", hash: `bench-${i + j}` })),
    });
  }
  void uuid;
  const insertMs = Math.round(performance.now() - t0);
  const ctx = { db } as never;
  const t1 = performance.now();
  const loaded = await loadKpiEvents(ctx, { ...filter, includeDummy: true });
  const loadMs = Math.round(performance.now() - t1);
  const t2 = performance.now();
  computeKpis(loaded, filter, params);
  const computeMs = Math.round(performance.now() - t2);
  const dbOut = { insertedEvents: events.length, insertMs, loadedEvents: loaded.length, loadMs, computeMs, totalDashboardMs: loadMs + computeMs };
  writeFileSync("docs/bench-kpi-db-result.json", JSON.stringify(dbOut, null, 2));
  console.log(JSON.stringify(dbOut, null, 2));
  await db.$executeRawUnsafe(`TRUNCATE "events" RESTART IDENTITY`);
  await db.$disconnect();
}
