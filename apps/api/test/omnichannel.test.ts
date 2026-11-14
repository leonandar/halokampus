import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { renderFor, stripEmailReply } from "../src/channels/render.js";
import { CP, CP2, STAFF, ADMIN, ANSWERABLE, LOW_CONFIDENCE, createHarness, type Harness, type SimChannel, type SimMessage } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.reset());

const db = () => h.ctx.db;
const tick = (s = 1) => h.clock.advance(s * 1000);

/** Press an action: native button when the channel rendered one, typed option otherwise. */
async function press(channel: SimChannel, from: string, msg: SimMessage, idOrPrefix: string) {
  const btn = msg.buttons.find((b) => b.id === idOrPrefix || b.id.startsWith(idOrPrefix));
  if (btn) return h.sim(channel, from, { buttonId: btn.id, buttonTitle: btn.title });
  // Typed fallback: "Balas dengan: 1 = Membantu · 2 = Tidak membantu · MANUSIA = …"
  const opts = [...msg.text.matchAll(/(\w+) = ([^·\n]+)/g)].map((m) => ({ key: m[1]!, title: m[2]!.trim() }));
  const titleFor: Record<string, RegExp> = { "fb:up": /^Membantu/, "fb:down": /^Tidak membantu/, human: /manusia/i, "consent:yes": /^Setuju/ };
  const re = titleFor[idOrPrefix] ?? new RegExp(`^${idOrPrefix}$`);
  const o = opts.find((x) => re.test(x.title));
  if (!o) throw new Error(`No option for ${idOrPrefix} in: ${msg.text}`);
  return h.sim(channel, from, { text: o.key });
}

const CHANNEL_USERS: Record<SimChannel, string> = {
  whatsapp: "6281200001001",
  instagram: "ig-17841400000001",
  messenger: "psid-5551000001",
  telegram: "700000001",
  email: "calon.dummy@contoh.invalid",
};
const REG: Record<SimChannel, string> = { whatsapp: "PMB-2027-000110", instagram: "PMB-2027-000111", messenger: "PMB-2027-000112", telegram: "PMB-2027-000113", email: "PMB-2027-000115" };

describe("FR-56 feature parity across every messaging channel", () => {
  const matrix: Record<string, Record<string, boolean>> = {};

  it.each(Object.keys(CHANNEL_USERS) as SimChannel[])("%s: consent → AI answer with source → feedback → data rights → file link → status (OTP) → human → CSAT/CES", async (channel) => {
    const from = CHANNEL_USERS[channel];
    const row: Record<string, boolean> = {};
    const last = async () => (await h.outbox(channel, from)).at(-1)!;

    // 1. consent first, the question is held and then answered
    await h.sim(channel, from, { text: ANSWERABLE });
    expect((await last()).kind).toBe("consent_prompt");
    tick();
    await h.sim(channel, from, { text: "SETUJU" });
    const answer = (await h.outbox(channel, from)).find((m) => m.kind === "answer")!;
    row.consent = true;
    row.qa_with_source = /Sumber: \[DUMMY\] Jalur/.test(answer.text);

    // 2. feedback: native buttons or typed options
    tick();
    await press(channel, from, answer, "fb:up");
    row.feedback = (await db().event.count({ where: { type: "ai_feedback", channel } })) === 1;

    // 3. data-rights link
    tick();
    await h.sim(channel, from, { text: "saya ingin menghapus data pribadi saya" });
    row.data_rights = /\/data-pribadi\?t=/.test((await last()).text);

    // 4. attachment → secure upload link (file is never fetched or stored)
    tick();
    await h.sim(channel, from, { attachment: true });
    row.file_check = /\/unggah\?t=/.test((await last()).text);

    // 5. status check with OTP verification
    tick();
    await h.sim(channel, from, { text: "Bagaimana status pendaftaran saya?" });
    tick();
    await h.sim(channel, from, { text: REG[channel] });
    tick();
    await h.sim(channel, from, { text: h.lastOtp() });
    const status = (await h.outbox(channel, from)).find((m) => m.kind === "status");
    row.status_check = Boolean(status?.text.includes(`Status pendaftaran ${REG[channel]}`));

    // 6. "Bicara dengan manusia"
    tick();
    await press(channel, from, status!, "human");
    row.human = (await last()).kind === "handoff_card";

    // 7. CP resolves → CSAT then CES on the same channel
    const t = await db().ticket.findFirstOrThrow({ where: { status: "T2_WAITING" } });
    const cp = await h.login(CP);
    await cp.post("/api/presence", { status: "online" });
    await cp.post(`/api/tickets/${t.id}/claim`);
    await cp.post(`/api/tickets/${t.id}/reply`, { text: "Halo Kak, ini balasan CP (DUMMY)." });
    row.human_reply_delivered = (await last()).text.includes("balasan CP");
    await cp.post(`/api/tickets/${t.id}/resolve`);
    const q1 = await last();
    expect(q1.text).toContain("[DUMMY]");
    await press(channel, from, q1, q1.buttons.length ? (q1.buttons.find((b) => b.title === "4")?.id ?? "") : "4");
    const q2 = await last();
    await press(channel, from, q2, q2.buttons.length ? (q2.buttons.find((b) => b.title === "5")?.id ?? "") : "5");
    row.survey = (await db().event.count({ where: { type: "survey_answered", channel } })) === 2;

    matrix[channel] = row;
    expect(row).toEqual({ consent: true, qa_with_source: true, feedback: true, data_rights: true, file_check: true, status_check: true, human: true, human_reply_delivered: true, survey: true });
  });

  it("summary matrix", () => {
    // Printed for docs/SKENARIO-UJI.md; every cell must be true.
    console.table(matrix);
    expect(Object.keys(matrix).length).toBeGreaterThan(0);
  });
});

describe("Webhook security (NFR-05)", () => {
  it("rejects unsigned/wrongly signed webhooks for Meta, Telegram and Email", async () => {
    const meta = await h.http.post("/webhooks/meta").set("x-hub-signature-256", "sha256=00").send({ object: "page", entry: [] });
    expect(meta.status).toBe(401);
    const tg = await h.http.post("/webhooks/telegram").set("x-telegram-bot-api-secret-token", "salah").send({ update_id: 1 });
    expect(tg.status).toBe(401);
    const em = await h.http.post("/webhooks/email").send({ from: "a@b.c", text: "x" });
    expect(em.status).toBe(401);
    const wa = await h.http.post("/webhooks/whatsapp").send({ object: "whatsapp_business_account", entry: [] });
    expect(wa.status).toBe(401);
  });
});

describe("Delivery status, unified inbox, channel admin", () => {
  it("SU-44: read receipts update the message delivery status (only forwards)", async () => {
    const from = CHANNEL_USERS.whatsapp;
    await h.sim("whatsapp", from, { text: "SETUJU" });
    await h.sim("whatsapp", from, { text: ANSWERABLE });
    const answer = (await h.outbox("whatsapp", from)).find((m) => m.kind === "answer")!;
    await h.http.post("/sim/whatsapp/read").send({ providerMessageIds: [answer.providerMessageId] });
    const m = await db().message.findFirstOrThrow({ where: { providerMessageId: answer.providerMessageId } });
    expect(m.deliveryStatus).toBe("read");
    await h.ctx.db.message.update({ where: { id: m.id }, data: {} });
    const { applyDeliveryStatuses } = await import("../src/services/delivery.js");
    expect(await applyDeliveryStatuses(h.ctx, [{ providerMessageId: answer.providerMessageId, status: "delivered" }])).toBe(0);
  });

  it("SU-55: unified inbox lists every human ticket; staff can reply on a chosen channel", async () => {
    const tg = CHANNEL_USERS.telegram;
    await h.sim("telegram", tg, { text: "SETUJU" });
    await h.sim("telegram", tg, { text: "Pembayaran saya gagal tapi saldo sudah terpotong" });
    const em = CHANNEL_USERS.email;
    tick();
    await h.sim("email", em, { text: "SETUJU" });
    await h.sim("email", em, { text: LOW_CONFIDENCE });
    const staff = await h.login(STAFF);
    const all = (await staff.get("/api/queue/all")).body.items;
    expect(all.map((i: any) => i.channel).sort()).toEqual(["email", "telegram"]);
    expect((await staff.get("/api/queue/all?channel=telegram")).body.items).toHaveLength(1);
    const cp = await h.login(CP);
    expect((await cp.get("/api/queue/all")).status).toBe(403);
    const pay = all.find((i: any) => i.channel === "telegram");
    await staff.post(`/api/tickets/${pay.id}/claim`);
    const detail = (await staff.get(`/api/tickets/${pay.id}`)).body;
    expect(detail.replyChannels).toEqual(["telegram"]);
    expect((await staff.post(`/api/tickets/${pay.id}/reply`, { text: "x", channel: "whatsapp" })).body.error).toBe("no_channel");
    expect((await staff.post(`/api/tickets/${pay.id}/reply`, { text: "Kami periksa pembayarannya (DUMMY).", channel: "telegram" })).status).toBe(200);
    expect((await h.outbox("telegram", tg)).at(-1)!.text).toContain("Kami periksa");
  });

  it("SU-42: admin can switch a channel off; its inbound traffic is then ignored and audited", async () => {
    const admin = await h.login(ADMIN);
    const list = (await admin.get("/api/admin/channels")).body.items;
    expect(list.find((c: any) => c.code === "telegram")).toMatchObject({ enabled: true, mode: "simulator", webhookSecured: true });
    expect((await admin.post("/api/admin/channels/telegram", { enabled: false })).status).toBe(200);
    await h.sim("telegram", CHANNEL_USERS.telegram, { text: ANSWERABLE });
    expect(await h.outbox("telegram", CHANNEL_USERS.telegram)).toHaveLength(0);
    expect(await db().auditLog.count({ where: { action: "channel.disable" } })).toBe(1);
    const cp = await h.login(CP);
    expect((await cp.get("/api/admin/channels")).status).toBe(403);
  });
});

describe("Phone logging (FR-51)", () => {
  it("requires verbal consent; a resolved call creates the same ticket/events as other channels, without a survey", async () => {
    const cp = await h.login(CP);
    expect((await cp.post("/api/phone-calls", { callerPhone: "081200009999", question: ANSWERABLE, outcome: "resolved" })).body.error).toBe("consent_required");
    const r = await cp.post("/api/phone-calls", { callerPhone: "081200009999", callerName: "Penelepon DUMMY", verbalConsent: true, question: ANSWERABLE, answer: "Jalurnya prestasi, tes tulis, mandiri (DUMMY).", outcome: "resolved" });
    expect(r.status).toBe(200);
    const t = await db().ticket.findUniqueOrThrow({ where: { id: r.body.ticketId } });
    expect(t).toMatchObject({ lastChannelCode: "phone", tier: "T2", status: "RESOLVED", category: "info_umum" });
    const types = (await db().event.findMany({ where: { ticketId: t.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["ticket_opened", "message_received", "first_human_response", "ticket_resolved"]));
    expect(types).not.toContain("survey_sent");
    expect(await db().consent.count({ where: { channelCode: "phone", purpose: "service" } })).toBe(1);
  });

  it("a payment call logged by a CP goes to Staf PMB (mandatory category)", async () => {
    const cp = await h.login(CP2);
    const r = await cp.post("/api/phone-calls", { callerPhone: "081200008888", verbalConsent: true, question: "Pembayaran saya gagal, saldo terpotong", outcome: "open" });
    expect(r.body).toMatchObject({ tier: "T3", category: "pembayaran" });
    const t = await db().ticket.findUniqueOrThrow({ where: { id: r.body.ticketId } });
    expect(t.status).toBe("T3_WAITING");
  });
});

describe("Reschedule (FR-14, the only AI write to the PMB system)", () => {
  it("verifies, offers slots allowed by the PMB policy, writes once, and refuses a second change", async () => {
    const c = await h.customer();
    await c.ask("Saya mau jadwal ulang tes");
    tick();
    await c.ask("PMB-2027-000104"); // DUMMY applicant in the "tes" stage
    tick();
    await c.ask(h.lastOtp());
    const offer = (await c.me()).messages.at(-1);
    expect(offer.text).toContain("Pilih jadwal pengganti");
    expect(offer.buttons.map((b: any) => b.id)).toEqual(["slot:S2", "slot:S3"]);
    await c.control("slot:S2");
    expect((await c.me()).messages.at(-1).text).toContain("sudah dipindahkan");
    expect(await db().auditLog.count({ where: { action: "pmb.reschedule" } })).toBe(1);
    tick();
    await c.ask("Saya mau jadwal ulang tes lagi");
    expect((await c.me()).messages.at(-1).text).toContain("sudah pernah diubah");
  });

  it("an applicant outside the test stage is told why and offered a human", async () => {
    const c = await h.customer();
    await c.ask("ganti jadwal tes saya");
    tick();
    await c.ask("PMB-2027-000102");
    tick();
    await c.ask(h.lastOtp());
    const msg = (await c.me()).messages.at(-1);
    expect(msg.text).toContain("hanya untuk pendaftar pada tahap tes");
    expect(msg.buttons.map((b: any) => b.id)).toContain("human");
  });
});

describe("Rendering helpers", () => {
  it("buttons beyond a channel's capacity become typed options", () => {
    const msg = { messageId: "m", kind: "answer" as const, text: "Halo", senderLabel: "AI", createdAt: "", buttons: [{ id: "fb:up:x", title: "Membantu" }, { id: "fb:down:x", title: "Tidak membantu" }, { id: "human", title: "Bicara dg manusia" }] };
    expect(renderFor("telegram", msg).buttons).toHaveLength(3);
    const email = renderFor("email", msg);
    expect(email.buttons).toHaveLength(0);
    expect(email.textOptions).toEqual({ "1": "fb:up:x", "2": "fb:down:x", MANUSIA: "human" });
    expect(email.body).toContain("Balas dengan: 1 = Membantu · 2 = Tidak membantu · MANUSIA = Bicara dg manusia");
  });
  it("strips quoted history from email replies", () => {
    expect(stripEmailReply("Terima kasih, sudah jelas.\n\nPada Sen, 16 Nov 2026 haloK@MPUS menulis:\n> jawaban lama")).toBe("Terima kasih, sudah jelas.");
    expect(stripEmailReply("Baik\n> kutipan\n-- \nTanda tangan")).toBe("Baik");
  });
});
