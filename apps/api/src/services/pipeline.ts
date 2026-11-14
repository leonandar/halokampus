import { answerAgent, runGuard, type IntentResult, type RetrievedChunk } from "@hk/ai";
import type { Conversation, Customer, Message, Prisma, Ticket } from "@hk/db";
import { computeConfidence, decideRoute, maskEmail, type RoutingDecision } from "@hk/domain";
import { CATEGORIES, type ChannelCode, type SlaDuration } from "@hk/shared";
import type { Ctx } from "../context.js";
import { randomDigits, sha256 } from "../crypto.js";
import type { Button, Citation } from "../channels/types.js";
import { hasConsent, profileOf, resolveCustomer, setConsents } from "./customers.js";
import { appendEvent } from "./ledger.js";
import { sendOutbound, storeInbound } from "./messaging.js";
import { retrieve } from "./kb.js";
import { escalateTicket, markFirstResponse, openOrGetTicket } from "./tickets.js";

export interface InboundInput {
  channel: ChannelCode;
  externalId: string;
  text?: string;
  displayName?: string;
  /** Button/control payload: consent:yes | human | fb:up:<aiActionId> | fb:down:<aiActionId> */
  controlId?: string;
}

const FEEDBACK_BUTTONS = (aiActionId: string): Button[] => [
  { id: `fb:up:${aiActionId}`, title: "Membantu" },
  { id: `fb:down:${aiActionId}`, title: "Tidak membantu" },
  { id: "human", title: "Bicara dg manusia" },
];

const REGNO_RE = /PMB-\d{4}-\d{4,8}/i;

// =============================================================== entry point
/**
 * Single inbound entry for every channel (FR-44): identity → consent → ticket →
 * store → AI (or human queue). Returns the stored message id when one was created.
 */
export async function receiveInbound(ctx: Ctx, input: InboundInput): Promise<{ customerId: string; messageId?: string; ticketId?: string; ignored?: string }> {
  const channelRow = await ctx.db.channel.findUnique({ where: { code: input.channel } });
  if (!channelRow?.enabled) return { customerId: "", ignored: "channel_disabled" };
  const { customer, conversation } = await resolveCustomer(ctx, input.channel, input.externalId, input.displayName);

  // Typed answers to options rendered as text (channels without buttons, FR-56).
  let controlId = input.controlId;
  const text = (input.text ?? "").trim();
  if (!controlId && text) {
    const options = ((conversation.state ?? {}) as { options?: Record<string, string> }).options ?? {};
    const key = text.toUpperCase().replace(/[.\s]+$/, "");
    if (options[key]) controlId = options[key];
    else if (/^(manusia|petugas|operator|cs)$/i.test(text)) controlId = "human";
  }
  if (controlId) {
    await handleControl(ctx, customer, conversation, controlId);
    return { customerId: customer.id };
  }
  if (!text) return { customerId: customer.id };
  if (text === "[lampiran]") {
    await sendUploadLink(ctx, customer, conversation);
    return { customerId: customer.id };
  }

  // Mandatory service consent (FR-63). Text channels can answer "SETUJU".
  if (!(await hasConsent(ctx, customer.id, "service"))) {
    if (/^setuju\b/i.test(text)) {
      await grantServiceConsentAndResume(ctx, customer, conversation);
      return { customerId: customer.id };
    }
    const held = await storeInbound(ctx, conversation, { text, ticketId: null, customerPseudoId: customer.pseudoId, isDummy: customer.isDummy });
    await ctx.db.conversation.update({ where: { id: conversation.id }, data: { pendingMessageId: held.id } });
    await sendConsentPrompt(ctx, customer, conversation);
    return { customerId: customer.id, messageId: held.id };
  }

  const { ticket } = await openOrGetTicket(ctx, customer, conversation, "lainnya");
  const msg = await storeInbound(ctx, conversation, { text, ticketId: ticket.id, customerPseudoId: customer.pseudoId, isDummy: customer.isDummy });
  if (ticket.tier === "T1") await ctx.dispatchAi(msg.id);
  return { customerId: customer.id, messageId: msg.id, ticketId: ticket.id };
}

async function sendConsentPrompt(ctx: Ctx, customer: Customer, conversation: Conversation) {
  const link = await dataRightsLink(ctx, customer, conversation.channelCode);
  await sendOutbound(ctx, {
    conversation,
    ticketId: null,
    sender: "system",
    kind: "consent_prompt",
    text:
      "Halo! Sebelum kami bantu: haloK@MPUS memproses pesan Anda untuk layanan helpdesk PMB, termasuk dengan bantuan AI. " +
      `Rincian & pilihan persetujuan lain: ${link}\nBalas SETUJU (atau tekan tombol) untuk melanjutkan.`,
    buttons: [{ id: "consent:yes", title: "Setuju" }],
    customerPseudoId: customer.pseudoId,
    isDummy: customer.isDummy,
  });
}

async function grantServiceConsentAndResume(ctx: Ctx, customer: Customer, conversation: Conversation) {
  await setConsents(ctx, customer, conversation.channelCode, { service: true });
  const conv = await ctx.db.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  if (!conv.pendingMessageId) return;
  // Frugality: the question asked before consenting is processed, not asked again.
  const pending = await ctx.db.message.findUnique({ where: { id: conv.pendingMessageId } });
  await ctx.db.conversation.update({ where: { id: conv.id }, data: { pendingMessageId: null } });
  if (!pending) return;
  const { ticket } = await openOrGetTicket(ctx, customer, conv, "lainnya");
  await ctx.db.message.update({ where: { id: pending.id }, data: { ticketId: ticket.id } });
  if (ticket.tier === "T1") await ctx.dispatchAi(pending.id);
}

/** Short-lived bearer link to the data-rights page, usable from any channel (FR-69). */
export async function dataRightsLink(ctx: Ctx, customer: Customer, channel: string): Promise<string> {
  const { randomToken } = await import("../crypto.js");
  const token = randomToken();
  await ctx.db.customerSession.create({ data: { id: sha256(token), customerId: customer.id, channelCode: channel, purpose: "data_rights", expiresAt: new Date(ctx.clock.now().getTime() + 24 * 3600_000) } });
  return `${ctx.env.WEB_PUBLIC_URL}/data-pribadi?t=${token}`;
}

/**
 * Channels whose attachments we do not fetch get a secure, short-lived link to the
 * browser-side file check instead (FR-56). Nothing is stored.
 */
export async function sendUploadLink(ctx: Ctx, customer: Customer, conversation: Conversation) {
  const { randomToken } = await import("../crypto.js");
  const token = randomToken();
  await ctx.db.customerSession.create({ data: { id: sha256(token), customerId: customer.id, channelCode: conversation.channelCode, purpose: "upload", expiresAt: new Date(ctx.clock.now().getTime() + 2 * 3600_000) } });
  await sendOutbound(ctx, {
    conversation,
    ticketId: conversation.ticketId,
    sender: "ai",
    kind: "system",
    text: `Untuk memeriksa format dan ukuran berkas, buka tautan aman ini (berlaku 2 jam): ${ctx.env.WEB_PUBLIC_URL}/unggah?t=${token}\nBerkas hanya diperiksa, tidak disimpan oleh haloK@MPUS.`,
    customerPseudoId: customer.pseudoId,
    isDummy: customer.isDummy,
  });
}

// ============================================================ control payloads
async function handleControl(ctx: Ctx, customer: Customer, conversation: Conversation, controlId: string) {
  if (controlId === "consent:yes") return grantServiceConsentAndResume(ctx, customer, conversation);
  if (!(await hasConsent(ctx, customer.id, "service"))) return sendConsentPrompt(ctx, customer, conversation);
  if (controlId === "human") return requestHuman(ctx, customer, conversation);
  if (controlId.startsWith("sv:")) return (await import("./surveys.js")).recordSurveyAnswer(ctx, customer, conversation, controlId);
  if (controlId.startsWith("slot:")) return confirmReschedule(ctx, customer, conversation, controlId.slice(5));
  const fb = controlId.match(/^fb:(up|down):([0-9a-f-]{36})$/);
  if (fb) return recordFeedback(ctx, customer, conversation, fb[2]!, fb[1] === "up");
}

/** "Bicara dengan manusia" always works, in every state (aturan perutean 6, FR-07). */
export async function requestHuman(ctx: Ctx, customer: Customer, conversation: Conversation) {
  const { ticket } = await openOrGetTicket(ctx, customer, conversation, "lainnya");
  if (ticket.tier === "T1") {
    await escalateTicket(ctx, ticket, { toTier: "T2", reason: "CUSTOMER_REQUESTED_HUMAN", actorType: "ai" });
  } else {
    await sendOutbound(ctx, {
      conversation,
      ticketId: ticket.id,
      sender: "system",
      kind: "system",
      text: `Pertanyaan Kakak sudah berada di antrean ${ticket.tier === "T2" ? "Mahasiswa CP" : "Staf PMB"}. Mohon ditunggu ya.`,
      customerPseudoId: customer.pseudoId,
      isDummy: customer.isDummy,
    });
  }
}

/** Helpful / not helpful per AI answer (FR-17); two "not helpful" in a row escalate (FR-06). */
export async function recordFeedback(ctx: Ctx, customer: Customer, conversation: Conversation, aiActionId: string, helpful: boolean) {
  const action = await ctx.db.aiAction.findUnique({ where: { id: aiActionId } });
  if (!action?.ticketId) return;
  const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id: action.ticketId } });
  if (ticket.customerId !== customer.id) return;
  const now = ctx.clock.now();
  const streak = helpful ? 0 : ticket.negativeFeedbackStreak + 1;
  await ctx.db.ticket.update({ where: { id: ticket.id }, data: { negativeFeedbackStreak: streak } });
  await appendEvent(ctx.db, { occurredAt: now, type: "ai_feedback", ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: conversation.channelCode, tier: ticket.tier, category: ticket.category, actorType: "customer", payload: { aiActionId, helpful, streak }, isDummy: customer.isDummy });
  if (helpful || ticket.tier !== "T1") return;
  if (streak >= 2) {
    await escalateTicket(ctx, ticket, { toTier: "T2", reason: "NEGATIVE_FEEDBACK_X2", actorType: "ai" });
  } else {
    await sendOutbound(ctx, {
      conversation,
      ticketId: ticket.id,
      sender: "ai",
      kind: "system",
      text: "Maaf jawabannya belum membantu. Boleh diperjelas pertanyaannya? Kakak juga bisa memilih Bicara dengan manusia.",
      buttons: [{ id: "human", title: "Bicara dg manusia" }],
      customerPseudoId: customer.pseudoId,
      isDummy: customer.isDummy,
    });
  }
}

// ================================================================= AI pipeline
interface Loaded {
  message: Message;
  conversation: Conversation;
  customer: Customer;
  ticket: Ticket;
  text: string;
}

async function load(ctx: Ctx, messageId: string): Promise<Loaded | null> {
  const message = await ctx.db.message.findUnique({ where: { id: messageId } });
  if (!message?.ticketId) return null;
  const conversation = await ctx.db.conversation.findUniqueOrThrow({ where: { id: message.conversationId } });
  const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: conversation.customerId } });
  const ticket = await ctx.db.ticket.findUniqueOrThrow({ where: { id: message.ticketId } });
  return { message, conversation, customer, ticket, text: ctx.crypto.decrypt(message.bodyEnc) };
}

/**
 * Multi-agent pipeline for one inbound message (ARSITEKTUR §3):
 * intent → (action | RAG answer) → policy guard → route (answer or escalate).
 */
export async function processInboundMessage(ctx: Ctx, messageId: string): Promise<void> {
  const l = await load(ctx, messageId);
  if (!l || l.ticket.tier !== "T1") return; // a human already owns the ticket
  const started = ctx.clock.now();
  const startedPerf = performance.now();
  const t1 = await ctx.params.get<SlaDuration>("PRM-02");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(500, t1.value * 1000 - 300));
  try {
    const state = (l.conversation.state ?? {}) as Record<string, unknown>;
    if (state.awaiting) return await continueVerification(ctx, l, state);

    const channel = await ctx.db.channel.findUnique({ where: { code: l.conversation.channelCode } });
    const aiPaused = Boolean(channel?.aiPaused);
    const intent = await ctx.intents.classify(l.text, { rulesOnly: aiPaused });
    let ticket = l.ticket;
    if (intent.category !== "lainnya" && ticket.category !== intent.category) {
      ticket = await ctx.db.ticket.update({ where: { id: ticket.id }, data: { category: intent.category } });
    }
    const thresholds = { confidence: await ctx.params.confidenceThreshold(), minRetrieval: await ctx.params.minRetrieval() };
    const versions = await ctx.params.versions(["PRM-01", "PRM-02", "PRM-09", "PRM-10", "PRM-20"]);
    const base = { category: intent.category, customerRequestedHuman: intent.requestHuman, negativeFeedbackStreak: ticket.negativeFeedbackStreak, aiPaused, thresholds };

    // Rules that decide before any answer is drafted: mandatory category, human, pause.
    const pre = decideRoute({ ...base, draft: undefined });
    if (pre.kind === "escalate" && pre.reason !== "AI_UNAVAILABLE") {
      const action = await recordAction(ctx, l, ticket, { agent: "intent", actionType: "handoff.escalate", authorityClass: "must_escalate", intent, routing: pre, outcome: "escalated", versions, latencyMs: Math.round(performance.now() - startedPerf) });
      await escalateTicket(ctx, ticket, { toTier: pre.tier, reason: pre.reason, actorType: "ai", mandatory: pre.mandatory, category: intent.category });
      ctx.realtime.toStaff("ai.action", await actionView(ctx, action.id), { roles: ["staff"] });
      return;
    }

    if (ctx.config.actionPatterns.reschedule.some((p) => new RegExp(p, "i").test(l.text))) return await rescheduleAction(ctx, l, ticket, intent, versions);
    if (intent.category === "status") return await statusAction(ctx, l, ticket, intent, versions, startedPerf);
    if (intent.category === "data_pribadi") return await dataRightsAction(ctx, l, ticket, intent, versions);

    // RAG answer agent
    const profile = profileOf(ctx, l.customer);
    const chunks = await retrieve(ctx, l.text, { profile, k: 4 });
    const draft = await answerAgent(ctx.llm, { question: l.text, chunks, profile, signal: abort.signal });
    const used = chunks.filter((c) => draft.usedChunkIds.includes(c.id));
    const retrievalTop = chunks[0]?.similarity ?? 0;
    const conf = computeConfidence({ retrieval: retrievalTop, intent: intent.probability, self: draft.selfConfidence }, await ctx.params.weights());
    const guard = runGuard({ actionKey: "kb.answer", outputText: draft.answer, citationCount: used.length }, ctx.config.guard);
    const route = decideRoute({ ...base, draft: { confidence: conf.score, retrievalTop, guardPassed: guard.passed } });
    const latencyMs = Math.round(performance.now() - startedPerf);
    const action = await recordAction(ctx, l, ticket, {
      agent: "answer",
      actionType: "kb.answer",
      authorityClass: guard.authorityClass,
      intent,
      confidence: conf.score,
      components: { ...conf, retrievalTop, intent: { category: intent.category, probability: intent.probability, method: intent.method, rulesHit: intent.rulesHit }, gates: { minRetrieval: thresholds.minRetrieval, threshold: thresholds.confidence } },
      citations: used,
      guard,
      routing: route,
      outcome: route.kind === "answer" ? "sent" : guard.passed ? "escalated" : "blocked",
      output: draft.answer,
      llm: draft.llm,
      versions,
      latencyMs,
    });

    if (route.kind === "answer") {
      const citations: Citation[] = used.map((c) => ({ title: c.title, section: c.section, version: c.version }));
      await sendOutbound(ctx, {
        conversation: l.conversation,
        ticketId: ticket.id,
        sender: "ai",
        kind: "answer",
        text: draft.answer,
        citations,
        buttons: FEEDBACK_BUTTONS(action.id),
        aiActionId: action.id,
        customerPseudoId: l.customer.pseudoId,
        isDummy: l.customer.isDummy,
        tier: "T1",
        category: ticket.category,
      });
      const at = ctx.clock.now();
      await appendEvent(ctx.db, { occurredAt: at, type: "ai_answer_sent", ticketId: ticket.id, customerPseudoId: l.customer.pseudoId, channel: l.conversation.channelCode, tier: "T1", category: ticket.category, actorType: "ai", payload: { aiActionId: action.id, confidence: conf.score, latencyMs, provider: draft.llm.provider }, policyVersions: versions, isDummy: l.customer.isDummy });
      await markFirstResponse(ctx, ticket, at);
    } else {
      if (!guard.passed) {
        await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "ai_guard_blocked", ticketId: ticket.id, customerPseudoId: l.customer.pseudoId, channel: l.conversation.channelCode, tier: "T1", category: ticket.category, actorType: "ai", payload: { aiActionId: action.id, violations: guard.violations }, isDummy: l.customer.isDummy });
      }
      await escalateTicket(ctx, ticket, { toTier: route.tier, reason: route.reason, actorType: "ai", confidence: conf.score, confidenceComponents: { retrieval: conf.components.retrieval, intent: conf.components.intent, self: conf.components.self }, mandatory: route.mandatory });
    }
    ctx.realtime.toStaff("ai.action", await actionView(ctx, action.id), { roles: ["staff"] });
  } catch (e) {
    // Provider failure or PRM-02 exceeded → human queue (FR-20).
    const fresh = await ctx.db.ticket.findUnique({ where: { id: l.ticket.id } });
    await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "ai_fallback", ticketId: l.ticket.id, customerPseudoId: l.customer.pseudoId, channel: l.conversation.channelCode, tier: "T1", actorType: "ai", payload: { error: abort.signal.aborted ? "timeout_PRM-02" : (e as Error).message.slice(0, 200), elapsedMs: ctx.clock.now().getTime() - started.getTime() }, isDummy: l.customer.isDummy });
    if (fresh && fresh.tier === "T1") await escalateTicket(ctx, fresh, { toTier: "T2", reason: "AI_UNAVAILABLE", actorType: "system" });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- ai_actions
async function recordAction(
  ctx: Ctx,
  l: Loaded,
  ticket: Ticket,
  a: {
    agent: string;
    actionType: string;
    authorityClass: string;
    intent: IntentResult;
    confidence?: number;
    components?: unknown;
    citations?: RetrievedChunk[];
    guard?: unknown;
    routing: RoutingDecision;
    outcome: string;
    output?: string;
    llm?: { provider: string; model: string; location: string; latencyMs: number };
    versions: Record<string, number>;
    latencyMs: number;
  },
) {
  return ctx.db.aiAction.create({
    data: {
      ticketId: ticket.id,
      inboundMessageId: l.message.id,
      agent: a.agent,
      actionType: a.actionType,
      authorityClass: a.authorityClass,
      category: a.intent.category,
      confidence: a.confidence ?? null,
      confidenceComponents: (a.components ?? { intent: { category: a.intent.category, probability: a.intent.probability, method: a.intent.method, rulesHit: a.intent.rulesHit } }) as Prisma.InputJsonValue,
      citations: (a.citations ?? []).map((c) => ({ chunkId: c.id, documentId: c.documentId, title: c.title, section: c.section, version: c.version, similarity: c.similarity })) as Prisma.InputJsonValue,
      guard: (a.guard ?? {}) as Prisma.InputJsonValue,
      routing: a.routing as unknown as Prisma.InputJsonValue,
      outcome: a.outcome,
      outputEnc: a.output ? ctx.crypto.encrypt(a.output) : null,
      provider: a.llm?.provider ?? null,
      model: a.llm?.model ?? null,
      location: a.llm?.location ?? null,
      latencyMs: a.latencyMs,
      policyVersions: a.versions,
      channelCode: l.conversation.channelCode,
      createdAt: ctx.clock.now(),
    },
  });
}

/** Supervision view of one AI action (FR-29). Output text is shown to staff only. */
export async function actionView(ctx: Ctx, id: string) {
  const a = await ctx.db.aiAction.findUniqueOrThrow({ where: { id }, include: { ticket: true, overrides: true } });
  return {
    id: a.id,
    ticketId: a.ticketId,
    ticketNumber: a.ticket?.number ?? null,
    agent: a.agent,
    actionType: a.actionType,
    authorityClass: a.authorityClass,
    category: a.category,
    confidence: a.confidence === null ? null : Number(a.confidence),
    components: a.confidenceComponents,
    citations: a.citations,
    guard: a.guard,
    routing: a.routing,
    outcome: a.outcome,
    output: ctx.crypto.decryptOpt(a.outputEnc),
    provider: a.provider,
    model: a.model,
    location: a.location,
    latencyMs: a.latencyMs,
    channel: a.channelCode,
    overridden: a.overrides.length > 0,
    createdAt: a.createdAt.toISOString(),
  };
}

// ------------------------------------------------------------- action agent
const STAGE_LABEL: Record<string, string> = {
  isi_formulir: "Pengisian formulir",
  pembayaran: "Pembayaran",
  unggah_berkas: "Unggah berkas",
  verifikasi: "Verifikasi berkas",
  tes: "Tes seleksi",
  pengumuman: "Pengumuman",
};
const DOC_STATUS: Record<string, string> = { belum_unggah: "belum diunggah", diunggah: "sudah diunggah", terverifikasi: "terverifikasi", ditolak: "ditolak" };

/** Status check (FR-14): read-only, via PmbAdapter, only for verified customers. */
async function statusAction(ctx: Ctx, l: Loaded, ticket: Ticket, intent: IntentResult, versions: Record<string, number>, startedPerf: number) {
  if (!l.customer.verifiedAt) {
    await ctx.db.conversation.update({ where: { id: l.conversation.id }, data: { state: { awaiting: "reg_no" } } });
    const action = await recordAction(ctx, l, ticket, { agent: "action", actionType: "verify.request", authorityClass: "allowed", intent, routing: { kind: "answer" }, outcome: "sent", versions, latencyMs: Math.round(performance.now() - startedPerf) });
    await sendOutbound(ctx, { conversation: l.conversation, ticketId: ticket.id, sender: "ai", kind: "system", text: "Untuk melihat status, mohon ketik nomor pendaftaran Kakak (contoh: PMB-2027-000123). Kami akan mengirim kode OTP ke email yang terdaftar. Ketik BATAL untuk membatalkan.", aiActionId: action.id, customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "status" });
    await markFirstResponse(ctx, ticket, ctx.clock.now());
    return;
  }
  await answerStatus(ctx, l, ticket, intent, versions, startedPerf);
}

async function answerStatus(ctx: Ctx, l: Loaded, ticket: Ticket, intent: IntentResult, versions: Record<string, number>, startedPerf: number) {
  const regNo = profileOf(ctx, l.customer).regNo;
  const applicant = regNo && ctx.pmb.available ? await ctx.pmb.getApplicant(regNo).catch(() => null) : null;
  if (!applicant) {
    await escalateTicket(ctx, ticket, { toTier: "T2", reason: "PMB_UNAVAILABLE", actorType: "ai", category: "status" });
    return;
  }
  const missing = applicant.documents.filter((d) => d.status === "belum_unggah" || d.status === "ditolak");
  const next = applicant.deadlines.map((d) => ({ ...d, t: new Date(d.at) })).filter((d) => d.t > ctx.clock.now()).sort((a, b) => a.t.getTime() - b.t.getTime())[0];
  const cal = await ctx.params.workCalendar();
  const text = [
    `Status pendaftaran ${applicant.regNo}: tahap ${STAGE_LABEL[applicant.stage] ?? applicant.stage}, pembayaran ${applicant.paymentStatus.replace(/_/g, " ")}.`,
    `Berkas: ${applicant.documents.map((d) => `${d.label} ${DOC_STATUS[d.status] ?? d.status}`).join("; ")}.`,
    missing.length ? `Masih perlu dilengkapi: ${missing.map((d) => d.label).join(", ")}.` : "Semua berkas sudah diunggah.",
    next ? `Tenggat terdekat: ${next.label}, ${cal.formatLocal(next.t)}.` : "",
  ].filter(Boolean).join(" ");
  const conf = computeConfidence({ retrieval: 1, intent: intent.probability, self: 1 }, await ctx.params.weights());
  const guard = runGuard({ actionKey: "pmb.read_status", outputText: text }, ctx.config.guard);
  const thresholds = { confidence: await ctx.params.confidenceThreshold(), minRetrieval: await ctx.params.minRetrieval() };
  const route = decideRoute({ category: "status", customerRequestedHuman: false, negativeFeedbackStreak: ticket.negativeFeedbackStreak, aiPaused: false, thresholds, draft: { confidence: conf.score, retrievalTop: 1, guardPassed: guard.passed } });
  const action = await recordAction(ctx, l, ticket, {
    agent: "action",
    actionType: "pmb.read_status",
    authorityClass: guard.authorityClass,
    intent,
    confidence: conf.score,
    components: { ...conf, note: "S_ret dan S_self = 1: jawaban berasal dari data sistem PMB (templat deterministik), bukan teks buatan LLM." },
    guard,
    routing: route,
    outcome: route.kind === "answer" ? "sent" : "escalated",
    output: text,
    versions,
    latencyMs: Math.round(performance.now() - startedPerf),
  });
  if (route.kind === "escalate") {
    await escalateTicket(ctx, ticket, { toTier: route.tier, reason: route.reason, actorType: "ai", confidence: conf.score });
    return;
  }
  await sendOutbound(ctx, { conversation: l.conversation, ticketId: ticket.id, sender: "ai", kind: "status", text, citations: [{ title: "Sistem informasi PMB" + (applicant.isDummy ? " [DUMMY]" : ""), section: "Data pendaftaran", version: 1 }], buttons: FEEDBACK_BUTTONS(action.id), aiActionId: action.id, customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "status" });
  await appendEvent(ctx.db, { occurredAt: ctx.clock.now(), type: "ai_action_executed", ticketId: ticket.id, customerPseudoId: l.customer.pseudoId, channel: l.conversation.channelCode, tier: "T1", category: "status", actorType: "ai", payload: { aiActionId: action.id, action: "pmb.read_status" }, isDummy: l.customer.isDummy });
  await markFirstResponse(ctx, ticket, ctx.clock.now());
  ctx.realtime.toStaff("ai.action", await actionView(ctx, action.id), { roles: ["staff"] });
}

async function dataRightsAction(ctx: Ctx, l: Loaded, ticket: Ticket, intent: IntentResult, versions: Record<string, number>) {
  const link = await dataRightsLink(ctx, l.customer, l.conversation.channelCode);
  const action = await recordAction(ctx, l, ticket, { agent: "action", actionType: "pdp.link", authorityClass: "allowed", intent, routing: { kind: "answer" }, outcome: "sent", versions, latencyMs: 0 });
  await sendOutbound(ctx, { conversation: l.conversation, ticketId: ticket.id, sender: "ai", kind: "system", text: `Kakak dapat melihat, mengunduh, mengoreksi, menarik persetujuan, atau meminta penghapusan data pribadi melalui tautan aman berikut (berlaku 24 jam): ${link}`, aiActionId: action.id, customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "data_pribadi" });
  await markFirstResponse(ctx, ticket, ctx.clock.now());
}

// ---------------------------------------------------------- reschedule (FR-14)
async function rescheduleAction(ctx: Ctx, l: Loaded, ticket: Ticket, intent: IntentResult, versions: Record<string, number>) {
  if (!l.customer.verifiedAt) {
    await ctx.db.conversation.update({ where: { id: l.conversation.id }, data: { state: { awaiting: "reg_no", then: "reschedule" } } });
    await sendOutbound(ctx, { conversation: l.conversation, ticketId: ticket.id, sender: "ai", kind: "system", text: "Untuk menjadwalkan ulang tes, mohon ketik nomor pendaftaran Kakak (contoh: PMB-2027-000123). Kode OTP akan dikirim ke email terdaftar. Ketik BATAL untuk membatalkan.", customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "jadwal" });
    await markFirstResponse(ctx, ticket, ctx.clock.now());
    return;
  }
  await offerSlots(ctx, l, ticket, intent, versions);
}

/** Offers the slots the PMB system allows; the PMB system's policy decides eligibility. */
async function offerSlots(ctx: Ctx, l: Loaded, ticket: Ticket, intent: IntentResult, versions: Record<string, number>) {
  const regNo = profileOf(ctx, l.customer).regNo;
  const slots = regNo && ctx.pmb.available ? await ctx.pmb.getTestSlots(regNo).catch(() => null) : null;
  if (!slots) return void (await escalateTicket(ctx, ticket, { toTier: "T2", reason: "PMB_UNAVAILABLE", actorType: "ai", category: "jadwal" }));
  const guard = runGuard({ actionKey: "schedule.offer" }, ctx.config.guard);
  const action = await recordAction(ctx, l, ticket, { agent: "action", actionType: "schedule.offer", authorityClass: guard.authorityClass, intent, guard, routing: { kind: "answer" }, outcome: "sent", versions, latencyMs: 0 });
  const base = { conversation: l.conversation, ticketId: ticket.id, sender: "ai" as const, kind: "system" as const, aiActionId: action.id, customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "jadwal" };
  if (!slots.allowed) {
    await sendOutbound(ctx, { ...base, text: `Penjadwalan ulang belum dapat dilakukan: ${slots.reason ?? "tidak sesuai kebijakan PMB"}. Bila perlu pertimbangan khusus, pilih Bicara dengan manusia.`, buttons: [{ id: "human", title: "Bicara dg manusia" }] });
  } else {
    await sendOutbound(ctx, { ...base, text: `Jadwal tes Kakak saat ini: ${slots.current?.label ?? "-"}. Pilih jadwal pengganti:`, buttons: slots.slots.map((s) => ({ id: `slot:${s.id}`, title: s.label.replace("[DUMMY] ", "").slice(0, 40) })), citations: [{ title: "Sistem informasi PMB [DUMMY]", section: "Jadwal tes", version: 1 }] });
  }
  await markFirstResponse(ctx, ticket, ctx.clock.now());
}

async function confirmReschedule(ctx: Ctx, customer: Customer, conversation: Conversation, slotId: string) {
  const regNo = profileOf(ctx, customer).regNo;
  const { ticket } = await openOrGetTicket(ctx, customer, conversation, "jadwal");
  if (!regNo || !customer.verifiedAt) return;
  const guard = runGuard({ actionKey: "schedule.reschedule" }, ctx.config.guard);
  if (!guard.passed) return void (await escalateTicket(ctx, ticket, { toTier: "T2", reason: "GUARD_BLOCKED", actorType: "ai" }));
  const r = await ctx.pmb.reschedule(regNo, slotId).catch(() => ({ ok: false as const }));
  const now = ctx.clock.now();
  const action = await ctx.db.aiAction.create({ data: { ticketId: ticket.id, agent: "action", actionType: "schedule.reschedule", authorityClass: guard.authorityClass, category: "jadwal", guard: guard as object, routing: { kind: "answer" }, outcome: r.ok ? "sent" : "failed", channelCode: conversation.channelCode, createdAt: now, confidenceComponents: { slotId } } });
  await appendEvent(ctx.db, { occurredAt: now, type: "ai_action_executed", ticketId: ticket.id, customerPseudoId: customer.pseudoId, channel: conversation.channelCode, tier: ticket.tier, category: "jadwal", actorType: "ai", payload: { aiActionId: action.id, action: "schedule.reschedule", ok: r.ok }, isDummy: customer.isDummy });
  const { appendAudit } = await import("./ledger.js");
  await appendAudit(ctx.db, { at: now, actorType: "ai", action: "pmb.reschedule", resourceType: "ticket", resourceId: ticket.id, detail: { slotId, ok: r.ok } });
  await sendOutbound(ctx, {
    conversation,
    ticketId: ticket.id,
    sender: "ai",
    kind: "system",
    text: r.ok && "slot" in r && r.slot ? `Jadwal tes Kakak sudah dipindahkan ke ${r.slot.label}. Perubahan tercatat di sistem PMB.` : "Maaf, jadwal tidak dapat diubah (tidak sesuai kebijakan atau slot penuh). Pilih Bicara dengan manusia bila perlu bantuan.",
    buttons: r.ok ? undefined : [{ id: "human", title: "Bicara dg manusia" }],
    aiActionId: action.id,
    customerPseudoId: customer.pseudoId,
    isDummy: customer.isDummy,
  });
}

// ------------------------------------------------------- verification (OTP)
/** Deterministic verification dialogue: registration no. → OTP to the registered email (FR-53). */
async function continueVerification(ctx: Ctx, l: Loaded, state: Record<string, unknown>) {
  const say = (text: string) => sendOutbound(ctx, { conversation: l.conversation, ticketId: l.ticket.id, sender: "ai", kind: "system", text, customerPseudoId: l.customer.pseudoId, isDummy: l.customer.isDummy, tier: "T1", category: "status" });
  const clear = () => ctx.db.conversation.update({ where: { id: l.conversation.id }, data: { state: {} } });
  if (/^batal\b/i.test(l.text)) {
    await clear();
    await say("Baik, verifikasi dibatalkan. Ada yang bisa kami bantu lagi?");
    return;
  }
  const otpCfg = await ctx.params.get<{ ttlSeconds: number; maxAttempts: number }>("PRM-17");
  if (state.awaiting === "reg_no") {
    const regNo = l.text.match(REGNO_RE)?.[0]?.toUpperCase();
    if (!regNo) return void (await say("Format nomor pendaftaran belum sesuai (contoh: PMB-2027-000123). Ketik BATAL untuk membatalkan."));
    const applicant = ctx.pmb.available ? await ctx.pmb.getApplicant(regNo).catch(() => null) : null;
    if (!applicant) return void (await say("Nomor pendaftaran tidak ditemukan. Periksa kembali atau ketik BATAL."));
    const code = randomDigits(6);
    await ctx.db.otp.create({ data: { customerId: l.customer.id, codeHash: sha256(`${l.customer.id}:${code}`), target: "reg_no", expiresAt: new Date(ctx.clock.now().getTime() + otpCfg.ttlSeconds * 1000) } });
    await ctx.mailer.send(applicant.email, "Kode verifikasi haloK@MPUS", `Kode verifikasi Anda: ${code}\nBerlaku ${Math.round(otpCfg.ttlSeconds / 60)} menit. Abaikan email ini bila Anda tidak memintanya.`);
    await ctx.db.conversation.update({ where: { id: l.conversation.id }, data: { state: { awaiting: "otp", regNoEnc: ctx.crypto.encrypt(regNo), then: state.then ?? null } } });
    await say(`Kode OTP 6 angka sudah dikirim ke ${maskEmail(applicant.email)}. Ketik kodenya di sini.`);
    return;
  }
  if (state.awaiting === "otp") {
    const otp = await ctx.db.otp.findFirst({ where: { customerId: l.customer.id, consumedAt: null }, orderBy: { createdAt: "desc" } });
    const code = l.text.replace(/\D/g, "");
    if (!otp || otp.expiresAt < ctx.clock.now() || otp.attempts >= otpCfg.maxAttempts) {
      await clear();
      return void (await say("Kode OTP kedaluwarsa atau percobaan habis. Silakan ulangi dengan mengetik: cek status saya."));
    }
    if (sha256(`${l.customer.id}:${code}`) !== otp.codeHash) {
      await ctx.db.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return void (await say("Kode OTP belum sesuai. Silakan coba lagi."));
    }
    await ctx.db.otp.update({ where: { id: otp.id }, data: { consumedAt: ctx.clock.now() } });
    const regNo = ctx.crypto.decrypt(String(state.regNoEnc));
    const applicant = await ctx.pmb.getApplicant(regNo);
    if (!applicant) return void (await clear());
    const bidx = ctx.crypto.blindIndex(regNo);
    const owner = await ctx.db.customer.findUnique({ where: { regNoBidx: bidx } });
    if (owner && owner.id !== l.customer.id) {
      // Same applicant already known from another channel: ask before merging (FR-53).
      await ctx.db.conversation.update({ where: { id: l.conversation.id }, data: { state: { awaiting: "link_consent", ownerId: owner.id } } });
      return void (await say("Nomor ini sudah terhubung dengan percakapan Kakak di kanal lain. Balas YA untuk menggabungkan riwayatnya (agar Kakak tidak perlu mengulang), atau TIDAK."));
    }
    await ctx.db.customer.update({
      where: { id: l.customer.id },
      data: {
        verifiedAt: ctx.clock.now(),
        regNoEnc: ctx.crypto.encrypt(regNo),
        regNoBidx: bidx,
        contactEmailEnc: ctx.crypto.encrypt(applicant.email),
        displayNameEnc: l.customer.displayNameEnc ?? ctx.crypto.encrypt(applicant.name.split(" ")[0] ?? ""),
        programCode: applicant.program,
        admissionPath: applicant.path,
        stage: applicant.stage,
      },
    });
    await clear();
    const refreshed = await load(ctx, l.message.id);
    const intent: IntentResult = { category: state.then === "reschedule" ? "jadwal" : "status", probability: 1, method: "rule", rulesHit: ["verified"], requestHuman: false, emotionHigh: false, scores: {} };
    if (state.then === "reschedule") await offerSlots(ctx, refreshed!, refreshed!.ticket, intent, await ctx.params.versions(["PRM-01"]));
    else await answerStatus(ctx, refreshed!, refreshed!.ticket, intent, await ctx.params.versions(["PRM-01", "PRM-09"]), performance.now());
    return;
  }
  if (state.awaiting === "link_consent") {
    if (/^ya\b/i.test(l.text)) await linkCustomers(ctx, l, String(state.ownerId));
    else await say("Baik, riwayat tidak digabungkan.");
    await clear();
  }
}

/** Merges this channel identity into the existing customer after consent (FR-53). */
async function linkCustomers(ctx: Ctx, l: Loaded, ownerId: string) {
  const now = ctx.clock.now();
  // An open ticket of the merged identity is folded into the owner's open ticket, so the
  // customer has one ticket and one timeline (FR-54). Its timers are cancelled.
  const ownerOpen = await ctx.db.ticket.findFirst({ where: { customerId: ownerId, status: { in: ["T1_AI", "T2_WAITING", "T2_ACTIVE", "T3_WAITING", "T3_ACTIVE", "REOPENED"] } }, orderBy: { openedAt: "desc" } });
  if (ownerOpen) {
    const mine = await ctx.db.ticket.findMany({ where: { customerId: l.customer.id, status: { in: ["T1_AI", "REOPENED"] } } });
    for (const t of mine) {
      await ctx.db.message.updateMany({ where: { ticketId: t.id }, data: { ticketId: ownerOpen.id } });
      await ctx.db.conversation.updateMany({ where: { ticketId: t.id }, data: { ticketId: ownerOpen.id } });
      await ctx.db.aiAction.updateMany({ where: { ticketId: t.id }, data: { ticketId: ownerOpen.id } });
      await ctx.db.slaTimer.updateMany({ where: { ticketId: t.id, state: "running" }, data: { state: "cancelled", settledAt: now } });
      await ctx.db.ticket.update({ where: { id: t.id }, data: { status: "CLOSED", closedAt: now, arrivalReason: "MERGED" } });
      await appendEvent(ctx.db, { occurredAt: now, type: "ticket_closed", ticketId: t.id, channel: l.conversation.channelCode, payload: { mergedInto: ownerOpen.id }, isDummy: t.isDummy });
    }
  }
  await ctx.db.$transaction([
    ctx.db.customerIdentity.updateMany({ where: { customerId: l.customer.id }, data: { customerId: ownerId, verifiedAt: now, linkedConsentAt: now } }),
    ctx.db.conversation.updateMany({ where: { customerId: l.customer.id }, data: { customerId: ownerId } }),
    ctx.db.ticket.updateMany({ where: { customerId: l.customer.id }, data: { customerId: ownerId } }),
    ctx.db.consent.updateMany({ where: { customerId: l.customer.id }, data: { customerId: ownerId } }),
  ]);
  const owner = await ctx.db.customer.findUniqueOrThrow({ where: { id: ownerId } });
  await appendEvent(ctx.db, { occurredAt: now, type: "identity_linked", customerPseudoId: owner.pseudoId, channel: l.conversation.channelCode, actorType: "customer", payload: { mergedPseudoId: l.customer.pseudoId }, isDummy: owner.isDummy });
  const conv = await ctx.db.conversation.findUniqueOrThrow({ where: { id: l.conversation.id } });
  await sendOutbound(ctx, { conversation: conv, ticketId: ownerOpen?.id ?? l.ticket.id, sender: "system", kind: "system", text: "Riwayat percakapan Kakak dari kanal lain sudah digabungkan.", customerPseudoId: owner.pseudoId, isDummy: owner.isDummy });
}

export const CATEGORY_LABELS = CATEGORIES;
