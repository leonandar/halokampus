import PDFDocument from "pdfkit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { processInactivity } from "../src/services/tickets.js";
import { ANSWERABLE, CP, CP2, LEADER, LOW_CONFIDENCE, STAFF, createHarness, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const db = () => h.ctx.db;
const tick = (s = 1) => h.clock.advance(s * 1000);
// Supertest needs an explicit parser to return binary bodies as Buffer.
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on("data", (c: Buffer) => parts.push(c));
  res.on("end", () => cb(null, Buffer.concat(parts)));
};
const lastTicket = () => db().ticket.findFirstOrThrow({ orderBy: { number: "desc" } });

/** Two-person parameter change (Staf proposes, Pimpinan approves). */
async function setParam(code: string, value: unknown) {
  const s = await h.login(STAFF);
  const l = await h.login(LEADER);
  const p = (await s.post("/api/params/proposals", { code, value, reason: "uji (DUMMY)" })).body;
  expect((await l.post(`/api/params/proposals/${p.id}/approve`)).status).toBe(200);
}

async function kpi(query = "from=2026-11-16&to=2026-11-16") {
  const staff = await h.login(STAFF);
  const r = await staff.get(`/api/kpi?${query}`);
  expect(r.status).toBe(200);
  return { body: r.body, k: (id: string) => r.body.kpis.find((x: any) => x.id === id) };
}

describe("FR-60 KPI from the live pipeline", () => {
  it("SU-60 · E2E-4: numbers follow what happened; an override changes the override rate", async () => {
    const a = await h.customer();
    await a.ask(ANSWERABLE); // contained
    tick();
    const b = await h.customer();
    await b.ask(LOW_CONFIDENCE); // → T2
    tick();
    const c = await h.customer();
    await c.ask("Pembayaran saya gagal tapi saldo sudah terpotong"); // → T3 mandatory
    let r = await kpi();
    expect(r.body.ticketCount).toBe(3);
    expect(r.k("containment")).toMatchObject({ numerator: 1, denominator: 3 });
    expect(r.k("esc_t2").numerator).toBe(1);
    expect(r.k("esc_mandatory").numerator).toBe(1);
    expect(r.k("override").value).toBe(0);
    expect(r.k("confidence_below")).toMatchObject({ numerator: 1, denominator: 2 });
    expect(r.k("fcr").status).toBe("needs_param");
    expect(r.k("frt").target).toBeNull();
    expect(r.body.containsDummy).toBe(true);
    // E2E-4: override → audit → KPI
    const staff = await h.login(STAFF);
    const act = await db().aiAction.findFirstOrThrow({ where: { actionType: "kb.answer", outcome: "sent" } });
    await staff.post(`/api/ai-actions/${act.id}/override`, { type: "cancel", cause: "factual_error", reason: "uji (DUMMY)", notifyCustomer: false });
    r = await kpi();
    expect(r.k("override")).toMatchObject({ value: 100, numerator: 1, breakdown: { factual_error: 1 } });
    // filters and RBAC
    expect((await kpi("from=2026-11-16&to=2026-11-16&category=pembayaran")).body.ticketCount).toBe(1);
    const leader = await h.login(LEADER);
    expect((await leader.get("/api/kpi")).status).toBe(200);
    const cp = await h.login(CP);
    expect((await cp.get("/api/kpi")).status).toBe(403);
  });

  it("PRM-12 reopen: writing again within N days reopens the same ticket (reopen KPI)", async () => {
    await setParam("PRM-12", 7);
    const c = await h.customer();
    await c.ask(LOW_CONFIDENCE);
    const t = await lastTicket();
    const cp = await h.login(CP);
    await cp.post("/api/presence", { status: "online" });
    await cp.post(`/api/tickets/${t.id}/claim`);
    await cp.post(`/api/tickets/${t.id}/reply`, { text: "Biaya Rp250.000 (DUMMY)." });
    await cp.post(`/api/tickets/${t.id}/resolve`);
    h.clock.advance(3600_000);
    await c.ask(ANSWERABLE);
    const again = await lastTicket();
    expect(again.id).toBe(t.id);
    expect(again.reopenCount).toBe(1);
    const r = await kpi();
    expect(r.k("reopen")).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    expect(r.k("fcr")).toMatchObject({ value: 0, status: "ok" });
  });

  it("PRM-11 inactivity: silent T1 tickets resolve by AI; silent waiting tickets count as abandoned", async () => {
    await setParam("PRM-11", 30);
    const a = await h.customer();
    await a.ask(ANSWERABLE);
    tick();
    const b = await h.customer();
    await b.ask(LOW_CONFIDENCE);
    h.clock.advance(31 * 60_000);
    expect(await processInactivity(h.ctx)).toEqual({ resolvedAi: 1, abandoned: 1 });
    expect(await processInactivity(h.ctx)).toEqual({ resolvedAi: 0, abandoned: 0 });
    const r = await kpi();
    expect(r.k("abandonment")).toMatchObject({ value: 100, numerator: 1, denominator: 1 });
    expect(r.k("resolution").n).toBe(1);
  });
});

describe("FR-40 targets and FR-61 Buku Model mapping", () => {
  it("FR-40: a target set through PRM-14 is shown next to the KPI; others say no target", async () => {
    await setParam("PRM-14", { frt: 60, containment: 70 });
    const c = await h.customer();
    await c.ask(ANSWERABLE);
    const r = await kpi();
    expect(r.k("frt").target).toBe(60);
    expect(r.k("containment").target).toBe(70);
    expect(r.k("asa").target).toBeNull();
  });
  it("FR-61: config/kpi-map.yaml lists every KPI id the engine produces", async () => {
    const { KPI_IDS } = await import("@hk/kpi");
    const r = await kpi();
    expect(Object.keys(r.body.kpiMap).sort()).toEqual([...KPI_IDS].sort());
    expect(r.body.kpis.map((x: any) => x.id).sort()).toEqual([...KPI_IDS].sort());
  });
});

describe("FR-62 research export and FR-32 audit export", () => {
  it("excludes DUMMY by default, needs consent for service improvement, contains no personal data, pseudonyms are stable", async () => {
    const c = await h.customer();
    await c.ask(`Nomor saya 081234567890, email budi.dummy@example.com. ${ANSWERABLE}`);
    tick();
    const other = await h.customer(); // no service_improvement consent
    await other.ask(LOW_CONFIDENCE);
    const staff = await h.login(STAFF);
    const def = await staff.get("/api/exports/research?from=2026-11-16&to=2026-11-16");
    expect(def.status).toBe(200);
    expect(def.text).not.toMatch(/ticket_opened/); // all customer data here is DUMMY
    await h.http.post("/public/consents").set("authorization", `Bearer ${c.token}`).send({ service_improvement: true });
    const r1 = await staff.get("/api/exports/research?from=2026-11-16&to=2026-11-16&includeDummy=true");
    const r2 = await staff.get("/api/exports/research?from=2026-11-16&to=2026-11-16&includeDummy=true");
    expect(r1.text).toMatch(/ticket_opened/);
    expect(Number(r1.headers["x-excluded-no-consent"])).toBeGreaterThan(0);
    for (const secret of ["081234567890", "budi.dummy", "Jalur pendaftaran", "PMB-2027"]) expect(r1.text).not.toContain(secret);
    const ids = await db().ticket.findMany({ select: { id: true } });
    for (const t of ids) expect(r1.text).not.toContain(t.id);
    const tickets = (t: string) => new Set(t.split("\r\n").slice(1).map((l) => l.split(",")[2]).filter(Boolean));
    expect([...tickets(r1.text)]).toEqual([...tickets(r2.text)]);
    expect(tickets(r1.text).size).toBe(1); // only the consenting customer's ticket
    const xlsx = await staff.get("/api/exports/research?from=2026-11-16&to=2026-11-16&format=xlsx&includeDummy=true").buffer(true).parse(binary);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    expect(await db().auditLog.count({ where: { action: "research.export" } })).toBe(4);
    const cp = await h.login(CP);
    expect((await cp.get("/api/exports/research")).status).toBe(403);
  });

  it("audit export carries the hash chain", async () => {
    const staff = await h.login(STAFF);
    await staff.post("/api/ai/pause", { channel: "web", paused: true, reason: "uji" });
    const r = await staff.get("/api/audit/export?format=csv");
    expect(r.status).toBe(200);
    expect(r.text.split("\r\n")[0]).toBe("seq,at,actor_type,actor_id,actor_role,action,resource_type,resource_id,detail,prev_hash,hash");
    expect(r.text).toContain("ai.pause");
  });
});

describe("FR-39 periodic reports", () => {
  it("generates PDF and XLSX from the KPI engine and stores them", async () => {
    const c = await h.customer();
    await c.ask(ANSWERABLE);
    const leader = await h.login(LEADER);
    const pdf = (await leader.post("/api/reports", { from: "2026-11-16", to: "2026-11-16", format: "pdf" })).body;
    const xlsx = (await leader.post("/api/reports", { from: "2026-11-16", to: "2026-11-16", format: "xlsx" })).body;
    const p = await leader.get(`/api/reports/${pdf.id}/download`).buffer(true).parse(binary);
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    const x = await leader.get(`/api/reports/${xlsx.id}/download`).buffer(true).parse(binary);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const list = (await leader.get("/api/reports")).body.items;
    expect(list).toHaveLength(2);
    expect(list[0].includesDummy).toBe(true);
  });
});

describe("FR-36 QA review, FR-34 CP supervision, FR-35 orchestration", () => {
  it("QA: needs a verdict on the AI answer; feeds the QA score and verified AI accuracy", async () => {
    const c = await h.customer();
    await c.ask(ANSWERABLE);
    tick();
    await c.control("human");
    const t = await lastTicket();
    const cp = await h.login(CP);
    await cp.post("/api/presence", { status: "online" });
    await cp.post(`/api/tickets/${t.id}/claim`);
    await cp.post(`/api/tickets/${t.id}/resolve`);
    const staff = await h.login(STAFF);
    const sample = (await staff.get("/api/qa/sample?from=2026-11-16&to=2026-11-16")).body;
    expect(sample.items.map((i: any) => i.id)).toEqual([t.id]);
    expect(sample.note).toContain("PRM-16");
    const scores = { c1: 5, c2: 4, c3: 3 };
    expect((await staff.post("/api/qa/reviews", { ticketId: t.id, scores })).body.error).toBe("ai_judgement_required");
    expect((await staff.post("/api/qa/reviews", { ticketId: t.id, scores: { c1: 9, c2: 4, c3: 3 }, aiAnswerCorrect: true })).body.error).toBe("invalid_score");
    expect((await staff.post("/api/qa/reviews", { ticketId: t.id, scores, aiAnswerCorrect: true })).body.score).toBe(80);
    expect((await staff.post("/api/qa/reviews", { ticketId: t.id, scores, aiAnswerCorrect: true })).status).toBe(409);
    const r = await kpi();
    expect(r.k("qa").value).toBe(80);
    expect(r.k("ai_accuracy")).toMatchObject({ value: 100, numerator: 1 });
    expect((await cp.post("/api/qa/reviews", { ticketId: t.id, scores, aiAnswerCorrect: true })).status).toBe(403);
  });

  it("CP supervision: overview, release a CP's ticket, return a T3 ticket, feedback the CP can read", async () => {
    const c = await h.customer();
    await c.ask(LOW_CONFIDENCE);
    const t = await lastTicket();
    const cp = await h.login(CP);
    await cp.post("/api/presence", { status: "online" });
    await cp.post(`/api/tickets/${t.id}/claim`);
    const staff = await h.login(STAFF);
    const over = (await staff.get("/api/supervision/cp")).body.items;
    expect(over.find((o: any) => o.name.startsWith("Rina"))).toMatchObject({ presence: "online", openTickets: 1 });
    expect((await staff.post(`/api/tickets/${t.id}/release`, {})).status).toBe(400);
    expect((await staff.post(`/api/tickets/${t.id}/release`, { reason: "Beban CP tinggi (DUMMY)" })).status).toBe(200);
    expect((await lastTicket()).status).toBe("T2_WAITING");
    // T3 → back to CP (not for mandatory categories)
    await cp.post(`/api/tickets/${t.id}/claim`);
    await cp.post(`/api/tickets/${t.id}/escalate`, { reason: "Butuh Staf (DUMMY)" });
    expect((await staff.post(`/api/tickets/${t.id}/return-to-cp`, { reason: "Cukup dijawab CP (DUMMY)" })).status).toBe(200);
    const back = await lastTicket();
    expect(back).toMatchObject({ tier: "T2", status: "T2_WAITING", arrivalReason: "STAFF_RETURNED" });
    tick();
    const pay = await h.customer();
    await pay.ask("Pembayaran saya gagal tapi saldo sudah terpotong");
    expect((await staff.post(`/api/tickets/${(await lastTicket()).id}/return-to-cp`, { reason: "x" })).body.error).toBe("mandatory_category");
    // feedback
    const cpUser = await db().user.findFirstOrThrow({ where: { email: CP } });
    expect((await staff.post("/api/cp-feedback", { cpUserId: cpUser.id, ticketId: t.id, text: "Jawaban sudah baik, tambahkan rujukan pedoman (DUMMY)." })).status).toBe(200);
    const mine = (await cp.get("/api/me/feedback")).body.items;
    expect(mine[0]).toMatchObject({ text: expect.stringContaining("rujukan pedoman"), unread: true });
    expect((await cp.get("/api/me/feedback")).body.items[0].unread).toBe(false);
    expect((await cp.get("/api/supervision/cp")).status).toBe(403);
    const cp2 = await h.login(CP2);
    expect((await cp2.get("/api/me/feedback")).body.items).toHaveLength(0);
  });

  it("orchestration: weekly cycle from config, checklist updates, closing snapshots the KPIs; leader read-only", async () => {
    const leader = await h.login(LEADER);
    expect((await leader.get("/api/orchestration/current")).body.cycle).toBeNull();
    const staff = await h.login(STAFF);
    const cur = (await staff.get("/api/orchestration/current")).body;
    expect(cur.period).toMatchObject({ cadence: "weekly", peak: false });
    expect(cur.period.start).toBe(new Date("2026-11-16T00:00:00+07:00").toISOString());
    const items = cur.cycle.checklist.items;
    expect(new Set(items.map((i: any) => i.fn))).toEqual(new Set(["plan", "teach", "monitor", "intervene", "learn"]));
    await staff.post(`/api/orchestration/${cur.cycle.id}/items/${items[0].id}`, { done: true, note: "Selesai (DUMMY)" });
    expect((await leader.post(`/api/orchestration/${cur.cycle.id}/items/${items[1].id}`, { done: true })).status).toBe(403);
    const closed = (await staff.post(`/api/orchestration/${cur.cycle.id}/close`)).body;
    expect(closed.kpiSnapshot).toHaveProperty("containment");
    expect((await staff.post(`/api/orchestration/${cur.cycle.id}/items/${items[1].id}`, { done: true })).status).toBe(409);
    expect((await leader.get("/api/orchestration")).body.items[0]).toMatchObject({ done: 1, closedAt: expect.any(String), periodStart: "2026-11-16" });
    expect((await staff.get("/api/orchestration/current")).body.cycle.id).toBe(cur.cycle.id); // same cycle is found again
  });

  it("PRM-18 peak window switches the cadence to daily", async () => {
    await setParam("PRM-18", [{ from: "2026-11-01", to: "2026-11-30" }]);
    const staff = await h.login(STAFF);
    const cur = (await staff.get("/api/orchestration/current")).body;
    expect(cur.period).toMatchObject({ cadence: "daily", peak: true });
  });
});

describe("FR-65 data-subject requests, FR-66 retention", () => {
  it("a delete request is executed by anonymising the customer; events stay, personal data goes", async () => {
    const c = await h.customer();
    await c.ask(`Saya Budi, nomor 081234567890. ${ANSWERABLE}`);
    const link = (await h.http.post("/public/data-rights/link").set("authorization", `Bearer ${c.token}`)).body.url as string;
    const token = new URL(link).searchParams.get("t")!;
    const dsr = (await h.http.post("/public/data-rights/requests").set("authorization", `Bearer ${token}`).send({ type: "delete", detail: "Hapus (DUMMY)" })).body;
    const staff = await h.login(STAFF);
    const list = (await staff.get("/api/dsr")).body.items;
    expect(list[0]).toMatchObject({ id: dsr.id, type: "delete", status: "open" });
    expect((await staff.post(`/api/dsr/${dsr.id}`, { status: "closed", execute: true })).body.error).toBe("note_required");
    tick(3600);
    expect((await staff.post(`/api/dsr/${dsr.id}`, { status: "closed", execute: true, note: "Dihapus sesuai permintaan (DUMMY)" })).status).toBe(200);
    const cust = await db().customer.findFirstOrThrow({ where: { anonymizedAt: { not: null } } });
    expect(cust.displayNameEnc).toBeNull();
    const bodies = (await db().message.findMany()).map((m) => h.ctx.crypto.decrypt(m.bodyEnc));
    expect(bodies.every((b) => b === "[dihapus]" || !b.includes("081234567890"))).toBe(true);
    expect(bodies.some((b) => b.includes("081234567890"))).toBe(false);
    expect((await h.http.get("/public/me").set("authorization", `Bearer ${c.token}`)).status).toBe(401);
    expect(await db().event.count({ where: { type: "ticket_opened" } })).toBe(1);
    const closed = await db().event.findFirstOrThrow({ where: { type: "dsr_closed" } });
    expect(closed.payload).toMatchObject({ type: "delete", executed: true, durationMs: 3600_000 });
    const r = await kpi();
    expect(r.k("dsr")).toMatchObject({ value: 1, breakdown: { closed: 1, meanHoursToClose: 1 } });
  });

  it("retention: skipped while PRM-08 is [PERLU DATA]; anonymises inactive customers once set", async () => {
    const staff = await h.login(STAFF);
    expect((await staff.post("/api/retention/run")).body).toMatchObject({ anonymized: 0, skipped: expect.stringContaining("PRM-08") });
    const c = await h.customer();
    await c.ask(ANSWERABLE);
    await setParam("PRM-08", 30);
    expect((await staff.post("/api/retention/run")).body.anonymized).toBe(0);
    h.clock.advance(31 * 86400_000);
    const s2 = await h.login(STAFF);
    expect((await s2.post("/api/retention/run")).body.anonymized).toBe(1);
    expect(await db().event.count({ where: { type: "retention_run" } })).toBe(3);
  });
});

describe("FR-58 usability survey, FR-33 KB from PDF", () => {
  it("usability items come only from config; answers are validated and recorded per role", async () => {
    const cp = await h.login(CP);
    const list = (await cp.get("/api/usability")).body.items;
    expect(list[0]).toMatchObject({ code: "sus", dummy: true, answered: false });
    expect(list[0].items[0].text).toContain("[DUMMY]");
    expect((await cp.post("/api/usability/sus", { answers: { sus_1: 9, sus_2: 3 } })).status).toBe(400);
    expect((await cp.post("/api/usability/sus", { answers: { sus_1: 4, sus_2: 3 } })).status).toBe(200);
    expect((await cp.get("/api/usability")).body.items[0].answered).toBe(true);
    const ev = await db().event.findFirstOrThrow({ where: { type: "survey_answered" } });
    expect(ev.payload).toMatchObject({ survey: "sus", respondent: "cp", dummyItems: true });
  });

  it("a PDF upload becomes a draft KB document with sections", async () => {
    const pdf = await new Promise<Buffer>((res) => {
      const doc = new PDFDocument();
      const parts: Buffer[] = [];
      doc.on("data", (c: Buffer) => parts.push(c));
      doc.on("end", () => res(Buffer.concat(parts)));
      doc.text("Beasiswa Prestasi");
      doc.text("DUMMY. Beasiswa prestasi diberikan kepada 50 pendaftar jalur prestasi dengan nilai rapor tertinggi.");
      doc.end();
    });
    const staff = await h.login(STAFF);
    const cookie = await h.http.post("/api/auth/login").send({ email: STAFF, password: "Test#2026-dummy" });
    const r = await h.http.post("/api/kb/upload").set("Cookie", cookie.headers["set-cookie"] as unknown as string[]).set("x-csrf-token", cookie.body.csrfToken).field("slug", "beasiswa-pdf").field("title", "[DUMMY] Beasiswa").attach("file", pdf, { filename: "beasiswa.pdf", contentType: "application/pdf" });
    expect(r.status).toBe(200);
    expect(r.body.chunks).toBeGreaterThanOrEqual(1);
    const doc = await db().kbDocument.findFirstOrThrow({ where: { slug: "beasiswa-pdf" }, include: { chunks: true } });
    expect(doc.status).toBe("draft");
    expect(doc.chunks.map((c) => c.content).join(" ")).toContain("Beasiswa prestasi diberikan");
    // A corrupt file is a client error with a clear message, never a 500.
    const bad = await h.http.post("/api/kb/upload").set("Cookie", cookie.headers["set-cookie"] as unknown as string[]).set("x-csrf-token", cookie.body.csrfToken).field("slug", "rusak").attach("file", Buffer.from("bukan pdf"), { filename: "rusak.pdf", contentType: "application/pdf" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unreadable_pdf");
    void staff;
  });
});
