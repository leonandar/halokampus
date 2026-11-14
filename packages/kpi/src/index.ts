/**
 * haloK@MPUS KPI engine (FR-60). Pure functions over the `events` stream: no database, no
 * clock. Every number shown on the dashboard, in reports and in research exports is
 * produced here, and every formula is documented in docs/KPI.md and covered by
 * hand-computed tests (KT-xx).
 */

export interface KpiEvent {
  seq?: number | bigint;
  occurredAt: Date;
  type: string;
  ticketId: string | null;
  channel: string | null;
  tier: string | null;
  category: string | null;
  actorType: string | null;
  actorId: string | null;
  payload: Record<string, any>;
  customerPseudoId?: string | null;
}

export interface KpiFilter {
  from: Date;
  /** Exclusive end. */
  to: Date;
  channel?: string;
  category?: string;
  tier?: string;
  agentId?: string;
}

export interface KpiParams {
  /** PRM-12, days; null → FCR/reopen window not defined. */
  reopenWindowDays: number | null;
  /** PRM-11, minutes; null → abandonment not measurable. */
  abandonMinutes: number | null;
  /** PRM-01 */
  confidenceThreshold: number;
  /** PRM-14 targets keyed by KPI id. */
  targets: Record<string, number>;
  timezone?: string;
}

export type KpiUnit = "seconds" | "milliseconds" | "percent" | "score" | "count" | "ratio";
export type KpiStatus = "ok" | "no_data" | "needs_param";

export interface KpiValue {
  id: string;
  label: string;
  group: "kecepatan" | "efektivitas" | "kualitas" | "tata_kelola_ai" | "beban_kerja" | "pdp";
  unit: KpiUnit;
  value: number | null;
  numerator?: number;
  denominator?: number;
  n: number;
  status: KpiStatus;
  note?: string;
  target: number | null;
  /** "lower" = smaller is better. */
  better: "higher" | "lower";
  breakdown?: Record<string, number | null>;
}

export interface KpiResult {
  kpis: KpiValue[];
  funnel: Array<{ step: string; label: string; count: number }>;
  slByChannel: Array<{ channel: string; tier: string; met: number; breached: number; value: number | null }>;
  series: Array<{ date: string; opened: number; escalated: number; contained: number; slMet: number; slBreached: number }>;
  confidenceHistogram: Array<{ bin: string; count: number }>;
  overrideCauses: Record<string, number>;
  volume: { byChannel: Record<string, number>; byHour: number[]; byCategory: Record<string, number> };
  backlog: Array<{ tier: string; open: number; meanAgeHours: number | null; maxAgeHours: number | null }>;
  occupancy: Array<{ agentId: string; onlineMinutes: number; handlingMinutes: number; value: number | null }>;
  ticketCount: number;
}

// ------------------------------------------------------------------ helpers
const inRange = (d: Date, f: KpiFilter) => d >= f.from && d < f.to;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
const round = (x: number | null, d = 2) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);
const secs = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

function byTime(a: KpiEvent, b: KpiEvent) {
  const d = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (d !== 0) return d;
  return Number(a.seq ?? 0) - Number(b.seq ?? 0);
}

interface TicketView {
  id: string;
  openedAt: Date;
  channel: string | null;
  category: string | null;
  events: KpiEvent[];
}

/** Groups events per ticket. A ticket exists in the KPI world only if its `ticket_opened` was observed. */
export function buildTickets(events: KpiEvent[]): Map<string, TicketView> {
  const map = new Map<string, TicketView>();
  const sorted = [...events].sort(byTime);
  for (const e of sorted) {
    if (!e.ticketId) continue;
    let t = map.get(e.ticketId);
    if (!t && e.type === "ticket_opened") {
      t = { id: e.ticketId, openedAt: e.occurredAt, channel: e.channel, category: e.category, events: [] };
      map.set(e.ticketId, t);
    }
    if (!t) continue;
    t.events.push(e);
    if (e.category) t.category = e.category; // final (latest) category
  }
  return map;
}

function ticketMatches(t: TicketView, f: KpiFilter) {
  return inRange(t.openedAt, f) && (!f.channel || t.channel === f.channel) && (!f.category || t.category === f.category);
}

function eventMatches(e: KpiEvent, f: KpiFilter, tickets: Map<string, TicketView>, opts: { tier?: boolean; agent?: boolean } = {}) {
  if (!inRange(e.occurredAt, f)) return false;
  if (f.channel && e.channel !== f.channel) return false;
  if (f.category) {
    const cat = e.category ?? (e.ticketId ? tickets.get(e.ticketId)?.category : null);
    if (cat !== f.category) return false;
  }
  if (opts.tier && f.tier && e.tier !== f.tier) return false;
  if (opts.agent && f.agentId && e.actorId !== f.agentId) return false;
  return true;
}

// Intl formatters are expensive to construct; build one per time zone and reuse (Phase 4 benchmark).
const fmtCache = new Map<string, { day: Intl.DateTimeFormat; hour: Intl.DateTimeFormat }>();
function fmts(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = {
      day: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
      hour: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }),
    };
    fmtCache.set(tz, f);
  }
  return f;
}
function localDate(d: Date, tz: string): string {
  return fmts(tz).day.format(d);
}
function localHour(d: Date, tz: string): number {
  return Number(fmts(tz).hour.format(d));
}

const HUMAN = new Set(["cp", "staff"]);

// ------------------------------------------------------------------ engine
export function computeKpis(events: KpiEvent[], f: KpiFilter, p: KpiParams): KpiResult {
  const tz = p.timezone ?? "Asia/Jakarta";
  const all = [...events].sort(byTime);
  const ticketsAll = buildTickets(all);
  const tickets = [...ticketsAll.values()].filter((t) => ticketMatches(t, f));
  const kpis: KpiValue[] = [];
  const add = (k: Omit<KpiValue, "target">) => kpis.push({ ...k, target: p.targets[k.id] ?? null });
  const stat = (n: number): KpiStatus => (n > 0 ? "ok" : "no_data");
  const ev = (type: string, opts?: { tier?: boolean; agent?: boolean }) => all.filter((e) => e.type === type && eventMatches(e, f, ticketsAll, opts));
  const has = (t: TicketView, type: string) => t.events.some((e) => e.type === type);
  const aiResponded = (t: TicketView) => t.events.some((e) => e.type === "ai_answer_sent" || e.type === "ai_action_executed");
  const escalated = (t: TicketView) => has(t, "escalation");

  // ---- KT-01 First Response Time
  const frt: number[] = [];
  for (const t of tickets) {
    const first = t.events.find((e) => e.type === "message_received");
    if (!first) continue;
    const resp = t.events.find((e) => e.type === "message_sent" && e.occurredAt >= first.occurredAt && ["ai", "cp", "staff"].includes(e.actorType ?? ""));
    if (resp) frt.push(secs(first.occurredAt, resp.occurredAt));
  }
  add({ id: "frt", label: "First Response Time (rerata)", group: "kecepatan", unit: "seconds", value: round(mean(frt)), n: frt.length, status: stat(frt.length), better: "lower", breakdown: { median: round(median(frt)) }, note: "Pesan pertama pelanggan → tanggapan pertama AI atau manusia (kartu sistem tidak dihitung)." });

  // ---- KT-02 Average Speed of Answer
  const asa: number[] = [];
  for (const t of ticketsAll.values()) {
    for (const e of t.events) {
      if (e.type !== "first_human_response" || !eventMatches(e, f, ticketsAll, { tier: true, agent: true })) continue;
      const esc = [...t.events].reverse().find((x) => x.type === "escalation" && x.occurredAt <= e.occurredAt);
      if (esc) asa.push(secs(esc.occurredAt, e.occurredAt));
    }
  }
  add({ id: "asa", label: "Average Speed of Answer", group: "kecepatan", unit: "seconds", value: round(mean(asa)), n: asa.length, status: stat(asa.length), better: "lower", breakdown: { median: round(median(asa)) }, note: "Eskalasi terakhir → tanggapan manusia pertama, per episode eskalasi." });

  // ---- KT-03 Service Level per SLA policy
  const slEvents = all.filter((e) => (e.type === "sla_met" || e.type === "sla_breach") && eventMatches(e, f, ticketsAll, { tier: true }));
  const slKey = (e: KpiEvent) => `${e.tier}:${e.payload.paramCode ?? "?"}`;
  const slGroups: Record<string, { met: number; breached: number }> = {};
  for (const e of slEvents) {
    const g = (slGroups[slKey(e)] ??= { met: 0, breached: 0 });
    if (e.type === "sla_met") g.met++;
    else g.breached++;
  }
  const slLabel: Record<string, string> = { "T1:PRM-02": "Service Level T1 (AI, PRM-02)", "T2:PRM-03": "Service Level T2 (CP, PRM-03)", "T3:PRM-04": "Service Level T3 (Staf, PRM-04)", "T3:PRM-05": "Service Level pembayaran (PRM-05)" };
  for (const key of Object.keys(slLabel)) {
    const g = slGroups[key] ?? { met: 0, breached: 0 };
    const n = g.met + g.breached;
    add({ id: `sl_${key.replace(":", "_").toLowerCase()}`, label: slLabel[key]!, group: "kecepatan", unit: "percent", value: round(pct(g.met, n)), numerator: g.met, denominator: n, n, status: stat(n), better: "higher" });
  }

  // ---- KT-04 Average Handle Time per tier (+ AI processing time)
  const handled: Record<string, number[]> = {};
  const intervals: Array<{ agent: string; start: Date; end: Date }> = [];
  for (const t of ticketsAll.values()) {
    const open = new Map<string, KpiEvent>();
    for (const e of t.events) {
      if (e.type === "handling_started" && e.actorId) open.set(e.actorId, e);
      if (e.type === "handling_ended" && e.actorId && open.has(e.actorId)) {
        const s = open.get(e.actorId)!;
        open.delete(e.actorId);
        intervals.push({ agent: e.actorId, start: s.occurredAt, end: e.occurredAt });
        if (!eventMatches(s, f, ticketsAll, { tier: true, agent: true })) continue;
        (handled[s.tier ?? "?"] ??= []).push(secs(s.occurredAt, e.occurredAt));
      }
    }
  }
  for (const tier of ["T2", "T3"]) {
    const xs = handled[tier] ?? [];
    add({ id: `aht_${tier.toLowerCase()}`, label: `Average Handle Time ${tier}`, group: "kecepatan", unit: "seconds", value: round(mean(xs)), n: xs.length, status: stat(xs.length), better: "lower", note: "Klaim → selesai/diteruskan oleh petugas yang sama." });
  }
  const aiLatency = ev("ai_answer_sent").map((e) => Number(e.payload.latencyMs)).filter(Number.isFinite);
  add({ id: "aht_t1_ai", label: "Waktu proses AI (T1)", group: "kecepatan", unit: "milliseconds", value: round(mean(aiLatency)), n: aiLatency.length, status: stat(aiLatency.length), better: "lower" });

  // ---- KT-05 Average Resolution Time
  const res: number[] = [];
  for (const t of tickets) {
    const r = t.events.find((e) => e.type === "ticket_resolved");
    if (r) res.push(secs(t.openedAt, r.occurredAt));
  }
  add({ id: "resolution", label: "Average Resolution Time", group: "kecepatan", unit: "seconds", value: round(mean(res)), n: res.length, status: stat(res.length), better: "lower", breakdown: { median: round(median(res)) } });

  // ---- KT-06 First Contact Resolution
  const resolved = tickets.filter((t) => has(t, "ticket_resolved"));
  if (p.reopenWindowDays === null) {
    add({ id: "fcr", label: "First Contact Resolution", group: "efektivitas", unit: "percent", value: null, n: resolved.length, status: "needs_param", better: "higher", note: "PRM-12 (jendela N hari) [PERLU DATA]." });
  } else {
    const win = p.reopenWindowDays * 86400_000;
    const fcr = resolved.filter((t) => {
      const r = t.events.find((e) => e.type === "ticket_resolved")!;
      const reopened = t.events.some((e) => e.type === "ticket_reopened" && e.occurredAt > r.occurredAt && e.occurredAt.getTime() - r.occurredAt.getTime() <= win);
      const humanTransfer = t.events.some((e) => e.type === "handoff" && (e.payload.from === "T2" || e.payload.from === "T3"));
      return !reopened && !humanTransfer;
    }).length;
    add({ id: "fcr", label: "First Contact Resolution", group: "efektivitas", unit: "percent", value: round(pct(fcr, resolved.length)), numerator: fcr, denominator: resolved.length, n: resolved.length, status: stat(resolved.length), better: "higher", note: `Selesai tanpa dibuka ulang dalam ${p.reopenWindowDays} hari dan tanpa perpindahan antarpetugas manusia.` });
  }

  // ---- KT-07 AI containment
  const contained = tickets.filter((t) => aiResponded(t) && !escalated(t)).length;
  add({ id: "containment", label: "AI Containment Rate", group: "efektivitas", unit: "percent", value: round(pct(contained, tickets.length)), numerator: contained, denominator: tickets.length, n: tickets.length, status: stat(tickets.length), better: "higher", note: "Tiket yang mendapat tanggapan AI dan tidak pernah dieskalasi." });

  // ---- KT-08 Escalation rates
  const toT2 = tickets.filter((t) => t.events.some((e) => e.type === "escalation" && e.payload.to === "T2")).length;
  const toT3 = tickets.filter((t) => t.events.some((e) => e.type === "escalation" && e.payload.to === "T3")).length;
  const mand = tickets.filter((t) => has(t, "escalation_mandatory")).length;
  const n = tickets.length;
  add({ id: "esc_t2", label: "Eskalasi ke Tingkat 2", group: "efektivitas", unit: "percent", value: round(pct(toT2, n)), numerator: toT2, denominator: n, n, status: stat(n), better: "lower" });
  add({ id: "esc_t3", label: "Eskalasi ke Tingkat 3", group: "efektivitas", unit: "percent", value: round(pct(toT3, n)), numerator: toT3, denominator: n, n, status: stat(n), better: "lower" });
  add({ id: "esc_mandatory", label: "Langsung T3 (kategori wajib)", group: "efektivitas", unit: "percent", value: round(pct(mand, n)), numerator: mand, denominator: n, n, status: stat(n), better: "lower" });

  // ---- KT-09 Reopen rate
  const reopened = resolved.filter((t) => has(t, "ticket_reopened")).length;
  add({ id: "reopen", label: "Reopen Rate", group: "efektivitas", unit: "percent", value: p.reopenWindowDays === null ? null : round(pct(reopened, resolved.length)), numerator: reopened, denominator: resolved.length, n: resolved.length, status: p.reopenWindowDays === null ? "needs_param" : stat(resolved.length), better: "lower", note: p.reopenWindowDays === null ? "PRM-12 [PERLU DATA]: tanpa jendela, pesan baru membuka tiket baru." : undefined });

  // ---- KT-10 Handoff rate
  const handoffs = tickets.map((t) => t.events.filter((e) => e.type === "handoff").length);
  add({ id: "handoff", label: "Transfer/Handoff per tiket", group: "efektivitas", unit: "ratio", value: round(mean(handoffs)), n: tickets.length, status: stat(tickets.length), better: "lower" });

  // ---- KT-11 Abandonment
  const escTickets = tickets.filter(escalated);
  const abandoned = escTickets.filter((t) => {
    const timeout = t.events.find((e) => e.type === "customer_inactive_timeout" && e.payload.waiting);
    if (!timeout) return false;
    const human = t.events.find((e) => e.type === "first_human_response");
    return !human || human.occurredAt > timeout.occurredAt;
  }).length;
  add({ id: "abandonment", label: "Abandonment Rate", group: "efektivitas", unit: "percent", value: p.abandonMinutes === null ? null : round(pct(abandoned, escTickets.length)), numerator: abandoned, denominator: escTickets.length, n: escTickets.length, status: p.abandonMinutes === null ? "needs_param" : stat(escTickets.length), better: "lower", note: p.abandonMinutes === null ? "PRM-11 (batas tidak aktif) [PERLU DATA]." : `Pelanggan tidak aktif ${p.abandonMinutes} menit sebelum ditanggapi manusia.` });

  // ---- KT-12..14 CSAT, CES, NPS
  const survey = (code: string) => ev("survey_answered").filter((e) => e.payload.survey === code);
  const surveyScore = (e: KpiEvent) => mean(Object.values(e.payload.answers ?? {}).map(Number).filter(Number.isFinite));
  for (const [code, label, better] of [["csat", "CSAT (rerata skor)", "higher"], ["ces", "Customer Effort Score (rerata)", "lower"]] as const) {
    const xs = survey(code).map(surveyScore).filter((x): x is number => x !== null);
    const dummy = survey(code).some((e) => e.payload.dummyItems);
    const max = survey(code)[0]?.payload.scale?.max;
    const breakdown: Record<string, number | null> = {};
    if (code === "csat" && max) breakdown.top2Percent = round(pct(xs.filter((x) => x >= max - 1).length, xs.length));
    add({ id: code, label, group: "kualitas", unit: "score", value: round(mean(xs)), n: xs.length, status: stat(xs.length), better, breakdown, note: dummy ? "Butir survei masih DUMMY — angka bukan data penelitian." : undefined });
  }
  const nps = survey("nps").map(surveyScore).filter((x): x is number => x !== null);
  add({ id: "nps", label: "Net Promoter Score", group: "kualitas", unit: "score", value: nps.length ? round(pct(nps.filter((x) => x >= 9).length, nps.length)! - pct(nps.filter((x) => x <= 6).length, nps.length)!) : null, n: nps.length, status: stat(nps.length), better: "higher", note: "Opsional; aktif bila survei `nps` ada di PRM-15." });

  // ---- KT-15 QA score, KT-17 verified AI accuracy
  const qa = ev("qa_review_submitted").filter((e) => !f.agentId || e.payload.reviewedUserId === f.agentId);
  const qaScores = qa.map((e) => Number(e.payload.score)).filter(Number.isFinite);
  add({ id: "qa", label: "Skor Quality Assurance", group: "kualitas", unit: "score", value: round(mean(qaScores)), n: qaScores.length, status: stat(qaScores.length), better: "higher", note: "Skor formulir QA dinormalkan 0–100." });
  const judged = qa.filter((e) => typeof e.payload.aiAnswerCorrect === "boolean");
  const correct = judged.filter((e) => e.payload.aiAnswerCorrect).length;
  add({ id: "ai_accuracy", label: "Akurasi AI terverifikasi", group: "tata_kelola_ai", unit: "percent", value: round(pct(correct, judged.length)), numerator: correct, denominator: judged.length, n: judged.length, status: stat(judged.length), better: "higher" });

  // ---- KT-16 Override rate & causes
  const aiActs = ev("ai_answer_sent").length + ev("ai_action_executed").length;
  const overrides = ev("override_applied");
  const overrideCauses: Record<string, number> = {};
  for (const o of overrides) overrideCauses[o.payload.cause ?? "?"] = (overrideCauses[o.payload.cause ?? "?"] ?? 0) + 1;
  add({ id: "override", label: "Override Rate", group: "tata_kelola_ai", unit: "percent", value: round(pct(overrides.length, aiActs)), numerator: overrides.length, denominator: aiActs, n: aiActs, status: stat(aiActs), better: "lower", breakdown: overrideCauses });

  // ---- KT-18 Confidence distribution
  const conf = [
    ...ev("ai_answer_sent").map((e) => Number(e.payload.confidence)),
    ...ev("escalation").filter((e) => e.actorType === "ai" && e.payload.confidence !== null && e.payload.confidence !== undefined).map((e) => Number(e.payload.confidence)),
  ].filter(Number.isFinite);
  const confidenceHistogram = Array.from({ length: 10 }, (_, i) => ({ bin: `${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}`, count: conf.filter((c) => Math.min(9, Math.floor(c * 10 + 1e-9)) === i).length }));
  const below = conf.filter((c) => Math.round(c * 10000) < Math.round(p.confidenceThreshold * 10000)).length;
  add({ id: "confidence_below", label: "Proporsi keyakinan di bawah PRM-01", group: "tata_kelola_ai", unit: "percent", value: round(pct(below, conf.length)), numerator: below, denominator: conf.length, n: conf.length, status: stat(conf.length), better: "lower", breakdown: { mean: round(mean(conf), 4) } });

  // ---- KT-19 Backlog & age at f.to
  const backlog = ["T1", "T2", "T3"].map((tier) => {
    const ages: number[] = [];
    for (const t of ticketsAll.values()) {
      if (t.openedAt >= f.to || (f.channel && t.channel !== f.channel) || (f.category && t.category !== f.category)) continue;
      let state = "T1";
      for (const e of t.events) {
        if (e.occurredAt >= f.to) break;
        if (e.type === "escalation") state = e.payload.to;
        if (e.type === "ticket_resolved" || e.type === "ticket_closed") state = "done";
        if (e.type === "ticket_reopened") state = "T1";
      }
      if (state === tier) ages.push((f.to.getTime() - t.openedAt.getTime()) / 3600_000);
    }
    return { tier, open: ages.length, meanAgeHours: round(mean(ages)), maxAgeHours: ages.length ? round(Math.max(...ages)) : null };
  });
  const openHuman = backlog.filter((b) => b.tier !== "T1").reduce((a, b) => a + b.open, 0);
  add({ id: "backlog", label: "Backlog tiket manusia (T2+T3)", group: "beban_kerja", unit: "count", value: openHuman, n: openHuman, status: "ok", better: "lower" });

  // ---- KT-20 Occupancy per agent
  const presence = all.filter((e) => e.type === "presence_changed" && e.actorId).sort(byTime);
  const agents = [...new Set([...presence.map((e) => e.actorId!), ...intervals.map((i) => i.agent)])].filter((a) => !f.agentId || a === f.agentId);
  const clip = (s: Date, e: Date) => Math.max(0, Math.min(e.getTime(), f.to.getTime()) - Math.max(s.getTime(), f.from.getTime()));
  const occupancy = agents.map((agent) => {
    let online = 0;
    const ps = presence.filter((e) => e.actorId === agent);
    ps.forEach((e, i) => {
      if (e.payload.status !== "online") return;
      const end = ps[i + 1]?.occurredAt ?? f.to;
      online += clip(e.occurredAt, end);
    });
    const handling = intervals.filter((i) => i.agent === agent).reduce((a, i) => a + clip(i.start, i.end), 0);
    return { agentId: agent, onlineMinutes: round(online / 60000)!, handlingMinutes: round(handling / 60000)!, value: online > 0 ? round((handling / online) * 100) : null };
  });
  // Only agents with recorded online time; handling without presence data cannot form a ratio.
  const occAll = occupancy.filter((o) => o.onlineMinutes > 0).reduce((a, o) => ({ on: a.on + o.onlineMinutes, h: a.h + o.handlingMinutes }), { on: 0, h: 0 });
  add({ id: "occupancy", label: "Occupancy CP & Staf", group: "beban_kerja", unit: "percent", value: round(pct(occAll.h, occAll.on)), numerator: occAll.h, denominator: occAll.on, n: occupancy.length, status: occAll.on > 0 ? "ok" : "no_data", better: "higher", note: "Waktu menangani ÷ waktu online; dapat > 100% bila menangani beberapa tiket bersamaan." });

  // ---- KT-21 Volume
  const received = ev("message_received");
  const volume = { byChannel: {} as Record<string, number>, byHour: new Array<number>(24).fill(0), byCategory: {} as Record<string, number> };
  for (const e of received) {
    volume.byChannel[e.channel ?? "?"] = (volume.byChannel[e.channel ?? "?"] ?? 0) + 1;
    volume.byHour[localHour(e.occurredAt, tz)]!++;
  }
  for (const t of tickets) volume.byCategory[t.category ?? "?"] = (volume.byCategory[t.category ?? "?"] ?? 0) + 1;
  add({ id: "volume_messages", label: "Pesan masuk", group: "beban_kerja", unit: "count", value: received.length, n: received.length, status: "ok", better: "higher" });
  add({ id: "volume_tickets", label: "Tiket dibuka", group: "beban_kerja", unit: "count", value: tickets.length, n: tickets.length, status: "ok", better: "higher" });

  // ---- KT-22 Data-subject requests
  const dsrOpened = ev("dsr_opened");
  const dsrClosed = ev("dsr_closed");
  const dsrDur = dsrClosed.map((e) => Number(e.payload.durationMs) / 3600_000).filter(Number.isFinite);
  add({ id: "dsr", label: "Permintaan hak data (dibuka)", group: "pdp", unit: "count", value: dsrOpened.length, n: dsrOpened.length, status: "ok", better: "lower", breakdown: { closed: dsrClosed.length, meanHoursToClose: round(mean(dsrDur)) } });

  // ---- funnel, SL per channel, daily series
  const funnel = [
    { step: "opened", label: "Tiket dibuka", count: tickets.length },
    { step: "ai", label: "Ditanggapi AI", count: tickets.filter(aiResponded).length },
    { step: "t2", label: "Ke Mahasiswa CP (T2)", count: toT2 },
    { step: "t3", label: "Ke Staf PMB (T3)", count: toT3 },
    { step: "resolved", label: "Selesai", count: resolved.length },
  ];
  const slMap = new Map<string, { channel: string; tier: string; met: number; breached: number }>();
  for (const e of slEvents) {
    const k = `${e.channel}|${e.tier}`;
    const g = slMap.get(k) ?? { channel: e.channel ?? "?", tier: e.tier ?? "?", met: 0, breached: 0 };
    if (e.type === "sla_met") g.met++;
    else g.breached++;
    slMap.set(k, g);
  }
  const slByChannel = [...slMap.values()].map((g) => ({ ...g, value: round(pct(g.met, g.met + g.breached)) })).sort((a, b) => a.channel.localeCompare(b.channel) || a.tier.localeCompare(b.tier));
  const days = new Map<string, { date: string; opened: number; escalated: number; contained: number; slMet: number; slBreached: number }>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d, opened: 0, escalated: 0, contained: 0, slMet: 0, slBreached: 0 }).get(d)!;
  for (const t of tickets) {
    const d = day(localDate(t.openedAt, tz));
    d.opened++;
    if (escalated(t)) d.escalated++;
    else if (aiResponded(t)) d.contained++;
  }
  for (const e of slEvents) {
    const d = day(localDate(e.occurredAt, tz));
    if (e.type === "sla_met") d.slMet++;
    else d.slBreached++;
  }
  const series = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));

  return { kpis, funnel, slByChannel, series, confidenceHistogram, overrideCauses, volume, backlog, occupancy, ticketCount: tickets.length };
}

/** Ordered list of KPI ids, for kpi-map.yaml and exports. */
export const KPI_IDS = [
  "frt", "asa", "sl_t1_prm-02", "sl_t2_prm-03", "sl_t3_prm-04", "sl_t3_prm-05", "aht_t2", "aht_t3", "aht_t1_ai", "resolution",
  "fcr", "containment", "esc_t2", "esc_t3", "esc_mandatory", "reopen", "handoff", "abandonment",
  "csat", "ces", "nps", "qa", "ai_accuracy", "override", "confidence_below", "backlog", "occupancy", "volume_messages", "volume_tickets", "dsr",
] as const;
