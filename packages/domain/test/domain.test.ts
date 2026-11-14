import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "@hk/shared";
import {
  BusinessCalendar,
  computeConfidence,
  computeSlaWindow,
  decideRoute,
  isBelowThreshold,
  isSlaMet,
  maskEmail,
  maskName,
  maskPhone,
  classifyAction,
  canTransition,
  type RoutingInput,
} from "../src/index.js";

// DUMMY PRM-07 used throughout development: Mon–Fri 08:00–16:00 WIB.
const HOURS: WeeklyHours = {
  timezone: "Asia/Jakarta",
  holidays: ["2026-11-20"], // DUMMY holiday (Friday) to exercise the calendar
  days: {
    "1": [["08:00", "16:00"]],
    "2": [["08:00", "16:00"]],
    "3": [["08:00", "16:00"]],
    "4": [["08:00", "16:00"]],
    "5": [["08:00", "16:00"]],
  },
};
const cal = new BusinessCalendar(HOURS);
// 2026-11-16 is a Monday. WIB = UTC+7.
const wib = (iso: string) => new Date(`${iso}+07:00`);

describe("threshold comparison (FR-03)", () => {
  it("KB-01: exactly 0.75 is not below PRM-01 = 0.75", () => {
    expect(isBelowThreshold(0.75, 0.75)).toBe(false);
  });
  it("KB-02: 0.7499 is below 0.75", () => {
    expect(isBelowThreshold(0.7499, 0.75)).toBe(true);
  });
  it("is robust to float drift (0.7499999999999999 counts as 0.7500)", () => {
    expect(0.7499999999999999 < 0.75).toBe(true); // raw float comparison would escalate
    expect(isBelowThreshold(0.7499999999999999, 0.75)).toBe(false);
  });
});

describe("composite confidence (FR-02)", () => {
  it("combines the three components with PRM-09 weights", () => {
    const r = computeConfidence({ retrieval: 0.8, intent: 0.7, self: 0.6 }, { retrieval: 0.5, intent: 0.3, self: 0.2 });
    // 0.5*0.8 + 0.3*0.7 + 0.2*0.6 = 0.40 + 0.21 + 0.12 = 0.73
    expect(r.score).toBe(0.73);
    expect(r.contributions.retrieval).toBeCloseTo(0.4);
  });
  it("normalises weights that do not sum to 1", () => {
    const r = computeConfidence({ retrieval: 1, intent: 0, self: 0 }, { retrieval: 2, intent: 1, self: 1 });
    expect(r.score).toBe(0.5);
  });
  it("self-assessment alone cannot reach the threshold", () => {
    const r = computeConfidence({ retrieval: 0, intent: 0, self: 1 }, { retrieval: 0.5, intent: 0.3, self: 0.2 });
    expect(isBelowThreshold(r.score, 0.75)).toBe(true);
  });
  it("rejects all-zero weights", () => {
    expect(() => computeConfidence({ retrieval: 1, intent: 1, self: 1 }, { retrieval: 0, intent: 0, self: 0 })).toThrow();
  });
});

describe("business calendar (PRM-07)", () => {
  it("knows open and closed times", () => {
    expect(cal.isOpen(wib("2026-11-16T08:00:00"))).toBe(true);
    expect(cal.isOpen(wib("2026-11-16T15:59:59"))).toBe(true);
    expect(cal.isOpen(wib("2026-11-16T16:00:00"))).toBe(false);
    expect(cal.isOpen(wib("2026-11-21T10:00:00"))).toBe(false); // Saturday
    expect(cal.isOpen(wib("2026-11-20T10:00:00"))).toBe(false); // DUMMY holiday
  });
  it("finds the next opening across the weekend", () => {
    expect(cal.nextOpening(wib("2026-11-21T21:00:00")).toISOString()).toBe(wib("2026-11-23T08:00:00").toISOString());
  });
  it("adds service seconds across closing time", () => {
    expect(cal.addServiceSeconds(wib("2026-11-16T15:59:00"), 180).toISOString()).toBe(wib("2026-11-17T08:02:00").toISOString());
  });
  it("business day examples from the doc comment", () => {
    expect(cal.addBusinessDays(wib("2026-11-16T14:00:00"), 1).toISOString()).toBe(wib("2026-11-17T14:00:00").toISOString());
    // Thu 14:00 + 1 → Fri is a holiday → Mon 14:00
    expect(cal.addBusinessDays(wib("2026-11-19T14:00:00"), 1).toISOString()).toBe(wib("2026-11-23T14:00:00").toISOString());
    // Saturday → counted from Monday 08:00, 8 working hours → Monday 16:00
    expect(cal.addBusinessDays(wib("2026-11-21T10:00:00"), 1).toISOString()).toBe(wib("2026-11-23T16:00:00").toISOString());
  });
  it("KB-09: payment SLA (2 business days) skips holiday and weekend", () => {
    const w = computeSlaWindow(wib("2026-11-18T10:00:00"), { unit: "business_days", value: 2 }, cal);
    // Wed 10:00 + 2 days: Thu 10:00 (1), Fri holiday, Mon 10:00 (2)
    expect(w.deadlineAt.toISOString()).toBe(wib("2026-11-23T10:00:00").toISOString());
  });
  it("formats Indonesian local time", () => {
    expect(cal.formatLocal(wib("2026-11-23T08:00:00"))).toMatch(/Senin.*08\.00 WIB/);
  });
});

describe("SLA windows (FR-09/FR-10)", () => {
  it("T1 wall-clock seconds", () => {
    const w = computeSlaWindow(wib("2026-11-21T03:00:00"), { unit: "seconds", value: 5 }, cal);
    expect(w.deadlineAt.getTime() - w.startsAt.getTime()).toBe(5000);
  });
  it("KB-14: T2 escalation on Saturday 21:00 starts Monday 08:00, deadline 08:03", () => {
    const w = computeSlaWindow(wib("2026-11-21T21:00:00"), { unit: "service_seconds", value: 180 }, cal);
    expect(w.startsAt.toISOString()).toBe(wib("2026-11-23T08:00:00").toISOString());
    expect(w.deadlineAt.toISOString()).toBe(wib("2026-11-23T08:03:00").toISOString());
  });
  it("KB-03: a response exactly at the deadline meets the SLA", () => {
    const d = wib("2026-11-16T10:03:00");
    expect(isSlaMet(new Date(d), d)).toBe(true);
  });
  it("KB-04: one second late is a breach", () => {
    const d = wib("2026-11-16T10:03:00");
    expect(isSlaMet(new Date(d.getTime() + 1000), d)).toBe(false);
  });
});

describe("routing (aturan perutean)", () => {
  const base: RoutingInput = {
    category: "info_umum",
    customerRequestedHuman: false,
    negativeFeedbackStreak: 0,
    aiPaused: false,
    draft: { confidence: 0.9, retrievalTop: 0.8, guardPassed: true },
    thresholds: { confidence: 0.75, minRetrieval: 0.3 },
  };
  it("answers when everything passes", () => expect(decideRoute(base)).toEqual({ kind: "answer" }));
  it("KB-07: payment goes straight to T3 even with high confidence", () => {
    expect(decideRoute({ ...base, category: "pembayaran" })).toMatchObject({ tier: "T3", reason: "MANDATORY_CATEGORY", mandatory: true });
  });
  it("mandatory categories still route to T3 while AI is paused (KB-10)", () => {
    expect(decideRoute({ ...base, category: "perubahan_data", aiPaused: true })).toMatchObject({ tier: "T3" });
  });
  it("human request → T2", () => expect(decideRoute({ ...base, customerRequestedHuman: true })).toMatchObject({ tier: "T2", reason: "CUSTOMER_REQUESTED_HUMAN" }));
  it("KB-08: two negative feedbacks → T2", () => expect(decideRoute({ ...base, negativeFeedbackStreak: 2 })).toMatchObject({ reason: "NEGATIVE_FEEDBACK_X2" }));
  it("out of KB → T2", () => expect(decideRoute({ ...base, draft: { ...base.draft!, retrievalTop: 0.1 } })).toMatchObject({ reason: "OUT_OF_KB" }));
  it("guard block → T2", () => expect(decideRoute({ ...base, draft: { ...base.draft!, guardPassed: false } })).toMatchObject({ reason: "GUARD_BLOCKED" }));
  it("KB-01 at routing level: 0.75 answers", () => expect(decideRoute({ ...base, draft: { ...base.draft!, confidence: 0.75 } })).toEqual({ kind: "answer" }));
  it("KB-02 at routing level: 0.7499 escalates", () => expect(decideRoute({ ...base, draft: { ...base.draft!, confidence: 0.7499 } })).toMatchObject({ reason: "LOW_CONFIDENCE" }));
  it("no draft (provider failure) escalates", () => expect(decideRoute({ ...base, draft: undefined })).toMatchObject({ reason: "AI_UNAVAILABLE" }));
});

describe("masking (FR-26)", () => {
  it("masks phone, email and name", () => {
    expect(maskPhone("081234567890")).toBe("0812*****890");
    expect(maskEmail("budi.santoso@example.com")).toBe("b***********@example.com");
    expect(maskName("Budi Santoso Wijaya")).toBe("Budi S. W.");
  });
});

describe("authority & ticket state", () => {
  it("unknown AI actions fail closed", () => {
    expect(classifyAction("pmb.update_applicant", [{ actionKey: "kb.answer", authorityClass: "allowed" }])).toBe("forbidden");
  });
  it("enforces ticket transitions", () => {
    expect(canTransition("T2_WAITING", "T3_WAITING")).toBe(true);
    expect(canTransition("CLOSED", "T1_AI")).toBe(false);
  });
});
