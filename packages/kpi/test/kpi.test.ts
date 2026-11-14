import { describe, expect, it } from "vitest";
import { computeKpis, type KpiEvent, type KpiParams } from "../src/index.js";

/*
 * KT — hand-computed KPI tests. Synthetic events (not real data). Period: Mon 16 Nov 2026
 * 00:00Z–24:00Z. t0 = 03:00Z (10:00 WIB). Expected values are worked out in the comments
 * next to each assertion and repeated in docs/KPI.md §5.
 */
const T0 = Date.parse("2026-11-16T03:00:00Z");
const F = { from: new Date("2026-11-16T00:00:00Z"), to: new Date("2026-11-17T00:00:00Z") };
const P: KpiParams = { reopenWindowDays: 3, abandonMinutes: 30, confidenceThreshold: 0.75, targets: { frt: 60 } };

let seq = 0;
function e(type: string, ticket: string | null, sec: number, x: Partial<KpiEvent> & { payload?: Record<string, any> } = {}): KpiEvent {
  return { seq: ++seq, occurredAt: new Date(T0 + sec * 1000), type, ticketId: ticket, channel: null, tier: null, category: null, actorType: null, actorId: null, payload: {}, ...x };
}
const T = (ticket: string, channel: string, category: string) => (type: string, sec: number, x: Partial<KpiEvent> & { payload?: Record<string, any> } = {}) => e(type, ticket, sec, { channel, category, ...x });

const A = T("A", "web", "info_umum");
const B = T("B", "whatsapp", "biaya");
const C = T("C", "web", "pembayaran");
const D = T("D", "telegram", "persyaratan");
const E = T("E", "email", "lainnya");
const Fx = T("F", "web", "info_umum");
const DAY = 86400;

const EVENTS: KpiEvent[] = [
  // A — answered by AI, contained
  A("ticket_opened", 0, { tier: "T1" }), A("message_received", 0), A("message_sent", 2, { actorType: "ai" }),
  A("ai_answer_sent", 2, { tier: "T1", actorType: "ai", payload: { confidence: 0.85, latencyMs: 1500 } }), A("sla_met", 2, { tier: "T1", payload: { paramCode: "PRM-02" } }),
  // B — low confidence → CP → resolved
  B("ticket_opened", 0, { tier: "T1" }), B("message_received", 0),
  B("escalation", 3, { tier: "T2", actorType: "ai", payload: { from: "T1", to: "T2", reason: "LOW_CONFIDENCE", confidence: 0.7 } }), B("handoff", 3, { payload: { from: "T1", to: "T2" } }),
  B("message_sent", 3, { actorType: "system" }), B("sla_met", 3, { tier: "T1", payload: { paramCode: "PRM-02" } }),
  B("ticket_claimed", 60, { tier: "T2", actorType: "cp", actorId: "cp1" }), B("handling_started", 60, { tier: "T2", actorType: "cp", actorId: "cp1" }),
  B("first_human_response", 123, { tier: "T2", actorType: "cp", actorId: "cp1" }), B("message_sent", 123, { actorType: "cp", actorId: "cp1" }), B("sla_met", 123, { tier: "T2", payload: { paramCode: "PRM-03" } }),
  B("handling_ended", 300, { tier: "T2", actorType: "cp", actorId: "cp1" }), B("ticket_resolved", 300, { tier: "T2" }),
  B("survey_answered", 400, { payload: { survey: "csat", answers: { csat_1: 4 }, scale: { min: 1, max: 5 }, dummyItems: true } }),
  B("survey_answered", 401, { payload: { survey: "ces", answers: { ces_1: 2 }, scale: { min: 1, max: 5 }, dummyItems: true } }),
  // C — payment → T3 directly, SLA breach, resolved
  C("ticket_opened", 0, { tier: "T1" }), C("message_received", 0),
  C("escalation", 1, { tier: "T3", actorType: "ai", payload: { from: "T1", to: "T3", reason: "MANDATORY_CATEGORY", mandatory: true, confidence: null } }),
  C("escalation_mandatory", 1, { tier: "T3" }), C("handoff", 1, { payload: { from: "T1", to: "T3" } }), C("message_sent", 1, { actorType: "system" }),
  C("sla_met", 1, { tier: "T1", payload: { paramCode: "PRM-02" } }),
  C("handling_started", 600, { tier: "T3", actorType: "staff", actorId: "staff1" }),
  C("first_human_response", 660, { tier: "T3", actorType: "staff", actorId: "staff1" }), C("message_sent", 660, { actorType: "staff", actorId: "staff1" }),
  C("sla_breach", 7200, { tier: "T3", payload: { paramCode: "PRM-05" } }), C("handling_ended", 7200, { tier: "T3", actorType: "staff", actorId: "staff1" }), C("ticket_resolved", 7200, { tier: "T3" }),
  C("survey_answered", 7300, { payload: { survey: "csat", answers: { csat_1: 5 }, scale: { min: 1, max: 5 }, dummyItems: true } }),
  C("survey_answered", 7301, { payload: { survey: "ces", answers: { ces_1: 3 }, scale: { min: 1, max: 5 }, dummyItems: true } }),
  // D — AI answer, override, human requested, CP → Staf transfer, resolved, reopened 2 days later
  D("ticket_opened", 0, { tier: "T1" }), D("message_received", 0), D("message_sent", 4, { actorType: "ai" }),
  D("ai_answer_sent", 4, { tier: "T1", actorType: "ai", payload: { confidence: 0.8, latencyMs: 2500 } }), D("sla_met", 4, { tier: "T1", payload: { paramCode: "PRM-02" } }),
  D("override_applied", 100, { actorType: "staff", actorId: "staff1", payload: { cause: "outdated_kb", type: "replace" } }),
  D("escalation", 200, { tier: "T2", actorType: "ai", payload: { from: "T1", to: "T2", reason: "CUSTOMER_REQUESTED_HUMAN", confidence: null } }), D("handoff", 200, { payload: { from: "T1", to: "T2" } }),
  D("handling_started", 260, { tier: "T2", actorType: "cp", actorId: "cp2" }), D("first_human_response", 290, { tier: "T2", actorType: "cp", actorId: "cp2" }),
  D("message_sent", 290, { actorType: "cp", actorId: "cp2" }), D("sla_met", 290, { tier: "T2", payload: { paramCode: "PRM-03" } }),
  D("handling_ended", 400, { tier: "T2", actorType: "cp", actorId: "cp2" }),
  D("escalation", 400, { tier: "T3", actorType: "cp", actorId: "cp2", payload: { from: "T2", to: "T3", reason: "CP_ESCALATED" } }), D("handoff", 400, { payload: { from: "T2", to: "T3" } }),
  D("handling_started", 500, { tier: "T3", actorType: "staff", actorId: "staff1" }), D("first_human_response", 520, { tier: "T3", actorType: "staff", actorId: "staff1" }),
  D("handling_ended", 1000, { tier: "T3", actorType: "staff", actorId: "staff1" }), D("ticket_resolved", 1000, { tier: "T3" }),
  D("ticket_reopened", 2 * DAY, { tier: "T1" }),
  // E — email, AI unavailable → T2, customer silent (abandoned), T2 SLA breach → T3, never resolved
  E("ticket_opened", 0, { tier: "T1" }), E("message_received", 0),
  E("escalation", 5, { tier: "T2", actorType: "ai", payload: { from: "T1", to: "T2", reason: "AI_UNAVAILABLE", confidence: null } }), E("handoff", 5, { payload: { from: "T1", to: "T2" } }),
  E("message_sent", 5, { actorType: "system" }), E("sla_met", 5, { tier: "T1", payload: { paramCode: "PRM-02" } }),
  E("customer_inactive_timeout", 1800, { tier: "T2", payload: { minutes: 30, waiting: true } }),
  E("sla_breach", 3600, { tier: "T2", payload: { paramCode: "PRM-03" } }),
  E("escalation", 3600, { tier: "T3", actorType: "system", payload: { from: "T2", to: "T3", reason: "SLA_BREACH_T2" } }), E("handoff", 3600, { payload: { from: "T2", to: "T3" } }),
  // F — opened the day before, still waiting in T2 (backlog only)
  Fx("ticket_opened", -DAY, { tier: "T1" }), Fx("message_received", -DAY), Fx("escalation", -DAY + 10, { tier: "T2", actorType: "ai", payload: { from: "T1", to: "T2", reason: "LOW_CONFIDENCE", confidence: 0.6 } }),
  // QA, presence, DSR (no ticket filter)
  e("qa_review_submitted", null, 500, { ticketId: "A", payload: { score: 80, aiAnswerCorrect: true, reviewedUserId: "ai" } }),
  e("qa_review_submitted", null, 501, { ticketId: "D", payload: { score: 60, aiAnswerCorrect: false, reviewedUserId: "ai" } }),
  e("qa_review_submitted", null, 502, { ticketId: "B", payload: { score: 90, aiAnswerCorrect: null, reviewedUserId: "cp1" } }),
  e("presence_changed", null, 0, { actorId: "cp1", payload: { status: "online" } }), e("presence_changed", null, 3600, { actorId: "cp1", payload: { status: "offline" } }),
  e("presence_changed", null, 100, { actorId: "cp2", payload: { status: "online" } }), e("presence_changed", null, 1100, { actorId: "cp2", payload: { status: "offline" } }),
  e("dsr_opened", null, 0, { payload: { type: "delete" } }), e("dsr_closed", null, 7200, { payload: { durationMs: 7_200_000 } }),
];

const r = computeKpis(EVENTS, F, P);
const k = (id: string) => {
  const v = r.kpis.find((x) => x.id === id);
  if (!v) throw new Error(`no KPI ${id}`);
  return v;
};

describe("KT — KPI formulas on hand-computed synthetic events", () => {
  it("KT-00 ticket population: A–E opened in the period (F was opened the day before)", () => {
    expect(r.ticketCount).toBe(5);
  });
  it("KT-01 FRT: A 2 s, B 123 s (hand-off card excluded), C 660 s, D 4 s; E none → mean 197.25, median 63.5", () => {
    expect(k("frt")).toMatchObject({ value: 197.25, n: 4, breakdown: { median: 63.5 }, target: 60 });
  });
  it("KT-02 ASA: B 120, C 659, D 90 and 120 (two episodes) → 247.25", () => {
    expect(k("asa")).toMatchObject({ value: 247.25, n: 4 });
  });
  it("KT-03 Service level per policy: T1 5/5, T2 2/3, T3-PRM-05 0/1, T3-PRM-04 no data", () => {
    expect(k("sl_t1_prm-02")).toMatchObject({ value: 100, numerator: 5, denominator: 5 });
    expect(k("sl_t2_prm-03")).toMatchObject({ value: 66.67, numerator: 2, denominator: 3 });
    expect(k("sl_t3_prm-05")).toMatchObject({ value: 0, numerator: 0, denominator: 1 });
    expect(k("sl_t3_prm-04")).toMatchObject({ value: null, status: "no_data" });
  });
  it("KT-04 AHT: T2 (240+140)/2 = 190 s; T3 (6600+500)/2 = 3550 s; AI processing (1500+2500)/2 = 2000 ms", () => {
    expect(k("aht_t2").value).toBe(190);
    expect(k("aht_t3").value).toBe(3550);
    expect(k("aht_t1_ai").value).toBe(2000);
  });
  it("KT-05 Resolution: B 300, C 7200, D 1000 → 2833.33 s", () => {
    expect(k("resolution")).toMatchObject({ value: 2833.33, n: 3 });
  });
  it("KT-06 FCR (N = 3 days): B and C yes; D reopened within 2 days and moved CP→Staf → 2/3", () => {
    expect(k("fcr")).toMatchObject({ value: 66.67, numerator: 2, denominator: 3 });
  });
  it("KT-07 Containment: only A (D got an AI answer but was escalated) → 1/5 = 20%", () => {
    expect(k("containment")).toMatchObject({ value: 20, numerator: 1, denominator: 5 });
  });
  it("KT-08 Escalation: to T2 B,D,E 60%; to T3 C,D,E 60%; mandatory C 20%", () => {
    expect(k("esc_t2").value).toBe(60);
    expect(k("esc_t3").value).toBe(60);
    expect(k("esc_mandatory").value).toBe(20);
  });
  it("KT-09 Reopen: D of 3 resolved → 33.33%", () => {
    expect(k("reopen")).toMatchObject({ value: 33.33, numerator: 1, denominator: 3 });
  });
  it("KT-10 Handoff per ticket: 0+1+1+2+2 = 6 / 5 = 1.2", () => {
    expect(k("handoff").value).toBe(1.2);
  });
  it("KT-11 Abandonment: E of 4 escalated tickets → 25%", () => {
    expect(k("abandonment")).toMatchObject({ value: 25, numerator: 1, denominator: 4 });
  });
  it("KT-12/13 CSAT (4+5)/2 = 4.5, top-2 box 100%; CES (2+3)/2 = 2.5; DUMMY items flagged", () => {
    expect(k("csat")).toMatchObject({ value: 4.5, breakdown: { top2Percent: 100 } });
    expect(k("csat").note).toContain("DUMMY");
    expect(k("ces").value).toBe(2.5);
    expect(k("nps").status).toBe("no_data");
  });
  it("KT-15/17 QA (80+60+90)/3 = 76.67; verified AI accuracy 1 of 2 judged = 50%", () => {
    expect(k("qa").value).toBe(76.67);
    expect(k("ai_accuracy")).toMatchObject({ value: 50, numerator: 1, denominator: 2 });
  });
  it("KT-16 Override: 1 override / 2 AI actions = 50%, cause outdated_kb", () => {
    expect(k("override")).toMatchObject({ value: 50, breakdown: { outdated_kb: 1 } });
    expect(r.overrideCauses).toEqual({ outdated_kb: 1 });
  });
  it("KT-18 Confidence: {0.85, 0.80, 0.70} (F's 0.60 is outside the period) → 1/3 below 0.75; bins 0.7:1, 0.8:2", () => {
    expect(k("confidence_below")).toMatchObject({ value: 33.33, numerator: 1, denominator: 3 });
    expect(r.confidenceHistogram.find((b) => b.bin === "0.7–0.8")!.count).toBe(1);
    expect(r.confidenceHistogram.find((b) => b.bin === "0.8–0.9")!.count).toBe(2);
  });
  it("KT-19 Backlog at period end: T1 A (21 h), T2 F (45 h), T3 E (21 h); D's later reopen is ignored", () => {
    expect(r.backlog).toEqual([
      { tier: "T1", open: 1, meanAgeHours: 21, maxAgeHours: 21 },
      { tier: "T2", open: 1, meanAgeHours: 45, maxAgeHours: 45 },
      { tier: "T3", open: 1, meanAgeHours: 21, maxAgeHours: 21 },
    ]);
    expect(k("backlog").value).toBe(2);
  });
  it("KT-20 Occupancy: cp1 4/60 min = 6.67%, cp2 2.33/16.67 min = 14%; overall (4+2.33)/(60+16.67) = 8.26%", () => {
    expect(r.occupancy.find((o) => o.agentId === "cp1")).toMatchObject({ onlineMinutes: 60, handlingMinutes: 4, value: 6.67 });
    expect(r.occupancy.find((o) => o.agentId === "cp2")).toMatchObject({ onlineMinutes: 16.67, handlingMinutes: 2.33, value: 14 });
    expect(r.occupancy.find((o) => o.agentId === "staff1")!.value).toBeNull();
    expect(k("occupancy").value).toBe(8.26);
  });
  it("KT-21 Volume: 5 messages (web 2, whatsapp 1, telegram 1, email 1), all at 10 WIB", () => {
    expect(r.volume.byChannel).toEqual({ web: 2, whatsapp: 1, telegram: 1, email: 1 });
    expect(r.volume.byHour[10]).toBe(5);
    expect(k("volume_tickets").value).toBe(5);
  });
  it("KT-22 DSR: 1 opened, 1 closed after 2 h", () => {
    expect(k("dsr")).toMatchObject({ value: 1, breakdown: { closed: 1, meanHoursToClose: 2 } });
  });
  it("funnel, SL per channel and daily series", () => {
    expect(r.funnel.map((f) => f.count)).toEqual([5, 2, 3, 3, 3]);
    expect(r.slByChannel.find((s) => s.channel === "email" && s.tier === "T2")).toMatchObject({ met: 0, breached: 1, value: 0 });
    expect(r.slByChannel.find((s) => s.channel === "web" && s.tier === "T1")).toMatchObject({ met: 2, value: 100 });
    expect(r.series).toEqual([{ date: "2026-11-16", opened: 5, escalated: 4, contained: 1, slMet: 7, slBreached: 2 }]);
  });
});

describe("KT — filters and missing parameters", () => {
  it("channel filter: WhatsApp → only B", () => {
    const w = computeKpis(EVENTS, { ...F, channel: "whatsapp" }, P);
    expect(w.ticketCount).toBe(1);
    expect(w.kpis.find((x) => x.id === "frt")!.value).toBe(123);
    expect(w.kpis.find((x) => x.id === "containment")!.value).toBe(0);
  });
  it("category filter: pembayaran → only C", () => {
    const c = computeKpis(EVENTS, { ...F, category: "pembayaran" }, P);
    expect(c.ticketCount).toBe(1);
    expect(c.kpis.find((x) => x.id === "esc_mandatory")!.value).toBe(100);
  });
  it("agent filter: cp2 → AHT T2 140 s, ASA 90 s", () => {
    const a = computeKpis(EVENTS, { ...F, agentId: "cp2" }, P);
    expect(a.kpis.find((x) => x.id === "aht_t2")!.value).toBe(140);
    expect(a.kpis.find((x) => x.id === "asa")!.value).toBe(90);
  });
  it("tier filter: T3 → ASA C 659 and D 120 → 389.5", () => {
    const t = computeKpis(EVENTS, { ...F, tier: "T3" }, P);
    expect(t.kpis.find((x) => x.id === "asa")!.value).toBe(389.5);
  });
  it("without PRM-11/PRM-12 the dependent KPIs say needs_param instead of inventing a number", () => {
    const m = computeKpis(EVENTS, F, { ...P, reopenWindowDays: null, abandonMinutes: null, targets: {} });
    for (const id of ["fcr", "reopen", "abandonment"]) expect(m.kpis.find((x) => x.id === id)).toMatchObject({ value: null, status: "needs_param" });
    expect(m.kpis.find((x) => x.id === "frt")!.target).toBeNull();
  });
  it("empty period returns no_data, never NaN", () => {
    const z = computeKpis(EVENTS, { from: new Date("2030-01-01T00:00:00Z"), to: new Date("2030-01-02T00:00:00Z") }, P);
    for (const x of z.kpis) expect(Number.isNaN(x.value as number)).toBe(false);
    expect(z.kpis.find((x) => x.id === "frt")!.status).toBe("no_data");
  });
});
