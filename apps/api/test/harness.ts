import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { MockProvider, type LLMProvider, type LlmRequest } from "@hk/ai";
import { PrismaClient } from "@hk/db";
import { FixedClock } from "@hk/domain";
import { buildMockPmb } from "@hk/mock-pmb";
import { createContext } from "../src/bootstrap.js";
import type { Ctx, Realtime } from "../src/context.js";
import { loadEnv } from "../src/env.js";
import { buildApp } from "../src/http/app.js";
import { MemoryMailer } from "../src/services/mailer.js";
import { processInboundMessage } from "../src/services/pipeline.js";
import { seed } from "../src/scripts/seed.js";
import { refreshLlmChains } from "../src/bootstrap.js";

export const PASSWORD = "Test#2026-dummy";
/** Monday 16 Nov 2026 10:00 WIB — inside the DUMMY service hours. */
export const MONDAY_10 = new Date("2026-11-16T10:00:00+07:00");

const BASE_URL = process.env.DATABASE_URL ?? "postgresql://halokampus:halokampus_dev@localhost:5432/halokampus";
const TEST_URL = BASE_URL.replace(/\/[^/?]+(\?|$)/, "/halokampus_test$1");

/** LLM provider wrapper that records prompts and can be switched to fail or misbehave. */
export class SpyProvider implements LLMProvider {
  readonly id = "mock";
  readonly model = "mock-spy";
  readonly location = "external" as const; // treat as external so redaction is exercised
  calls: LlmRequest[] = [];
  mode: "normal" | "fail" | "malicious" = "normal";
  private inner = new MockProvider();
  async complete(req: LlmRequest) {
    this.calls.push(req);
    if (this.mode === "fail") throw new Error("provider down (test)");
    if (this.mode === "malicious" && req.task === "answer") {
      const ids = ((req.context.chunks as Array<{ id: string }>) ?? []).map((c) => c.id);
      return { json: { answer: "Tenang, data Kakak sudah saya ubah dan Kakak pasti lulus.", self_confidence: 0.99, used_chunk_ids: ids.slice(0, 1) }, provider: this.id, model: this.model, location: this.location };
    }
    return this.inner.complete(req);
  }
}

export class RecordingRealtime implements Realtime {
  staff: Array<{ event: string; payload: unknown; roles?: string[] }> = [];
  customer: Array<{ customerId: string; event: string; payload: unknown }> = [];
  toStaff(event: string, payload: unknown, opts?: { roles?: string[] }) {
    this.staff.push({ event, payload, roles: opts?.roles });
  }
  toCustomer(customerId: string, event: string, payload: unknown) {
    this.customer.push({ customerId, event, payload });
  }
}

let migrated = false;
function migrateTestDb() {
  if (migrated) return;
  const admin = new PrismaClient({ datasources: { db: { url: BASE_URL } } });
  execSync(`docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -tc "SELECT 1 FROM pg_database WHERE datname='halokampus_test'" | grep -q 1 || docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -c "CREATE DATABASE halokampus_test"`, { stdio: "ignore", shell: "/bin/bash" });
  void admin.$disconnect();
  execSync("npx prisma migrate deploy", { cwd: resolve(import.meta.dirname, "../../../packages/db"), env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "ignore" });
  migrated = true;
}

const TRANSACTIONAL_TABLES = [
  "audit_logs", "events", "sim_outbox", "overrides", "ai_actions", "sla_timers", "escalations", "ticket_assignments", "messages",
  "conversations", "tickets", "otps", "consents", "customer_sessions", "customer_identities", "data_subject_requests", "customers",
  "presence_logs", "staff_sessions", "users", "cp_feedback", "generated_reports", "survey_responses", "surveys", "qa_reviews", "orchestration_cycles", "kb_chunks", "kb_documents", "policy_parameters", "ai_authority_rules",
];

export interface Harness {
  routes: Array<{ method: string; url: string; auth: string; permission?: string; customerPurpose?: unknown }>;
  ctx: Ctx;
  clock: FixedClock;
  spy: SpyProvider;
  mailer: MemoryMailer;
  realtime: RecordingRealtime;
  http: ReturnType<typeof request>;
  close(): Promise<void>;
  reset(): Promise<void>;
  login(email: string): Promise<Agent>;
  customer(): Promise<WebCustomer>;
  wa(phone: string, body: { text?: string; buttonId?: string }): Promise<void>;
  waOutbox(phone: string): Promise<Array<Record<string, any>>>;
  lastOtp(): string;
  sim(channel: SimChannel, from: string, body: { text?: string; buttonId?: string; buttonTitle?: string; attachment?: boolean }): Promise<void>;
  outbox(channel: SimChannel, to: string): Promise<SimMessage[]>;
}

export type SimChannel = "whatsapp" | "instagram" | "messenger" | "telegram" | "email";
export interface SimMessage {
  text: string;
  buttons: Array<{ id: string; title: string }>;
  kind: string;
  providerMessageId: string;
}

/** Normalises each provider's outbound payload to text + buttons for assertions. */
export function readPayload(channel: SimChannel, p: any): SimMessage {
  const meta = { kind: p._meta?.kind ?? "", providerMessageId: p._meta?.providerMessageId ?? "" };
  if (channel === "whatsapp") {
    if (p.type === "interactive") return { ...meta, text: p.interactive.body.text, buttons: p.interactive.action.buttons.map((b: any) => ({ id: b.reply.id, title: b.reply.title })) };
    return { ...meta, text: p.text.body, buttons: [] };
  }
  if (channel === "instagram" || channel === "messenger") return { ...meta, text: p.message.text, buttons: (p.message.quick_replies ?? []).map((q: any) => ({ id: q.payload, title: q.title })) };
  if (channel === "telegram") return { ...meta, text: p.text, buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => ({ id: b.callback_data, title: b.text })) };
  return { ...meta, text: `${p.subject}\n${p.text}`, buttons: [] };
}

export interface Agent {
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  csrf: string;
  userId: string;
}

export interface WebCustomer {
  token: string;
  ask(text: string): Promise<request.Response>;
  control(controlId: string): Promise<request.Response>;
  me(): Promise<any>;
}

export async function createHarness(opts: { env?: Record<string, string>; logStream?: NodeJS.WritableStream } = {}): Promise<Harness> {
  migrateTestDb();
  const env = loadEnv({ ...process.env, DATABASE_URL: TEST_URL, ENABLE_SIMULATORS: "true", AI_INLINE: "true", DISABLE_RATE_LIMIT: "true", CONFIG_DIR: resolve(import.meta.dirname, "../../../config"), WHATSAPP_APP_SECRET: "test-app-secret", META_APP_SECRET: "test-meta-secret", TELEGRAM_WEBHOOK_SECRET: "test-tg-secret", EMAIL_WEBHOOK_TOKEN: "test-email-token", PMB_API_URL: "", ...(opts.env ?? {}) });
  const pmbApp = buildMockPmb();
  await pmbApp.listen({ port: 0, host: "127.0.0.1" });
  const pmbUrl = `http://127.0.0.1:${(pmbApp.server.address() as AddressInfo).port}`;
  const { HttpPmbAdapter } = await import("../src/services/pmb.js");
  const clock = new FixedClock(MONDAY_10);
  const spy = new SpyProvider();
  const mailer = new MemoryMailer();
  const realtime = new RecordingRealtime();
  const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });
  const ctx = await createContext(env, {
    db,
    clock,
    mailer,
    realtime,
    providers: { mock: spy },
    pmb: new HttpPmbAdapter(pmbUrl),
    // Awaited inline so assertions run after the pipeline finished.
    dispatchAi: async (c, id) => {
      await refreshLlmChains(c);
      await processInboundMessage(c, id);
    },
  });
  const app = await buildApp(ctx, opts.logStream ? { logger: true, logStream: opts.logStream } : {});
  await app.ready();
  const http = request(app.server);

  const h: Harness = {
    routes: (app as unknown as { routeRegistry: Harness["routes"] }).routeRegistry,
    ctx,
    clock,
    spy,
    mailer,
    realtime,
    http,
    async close() {
      await app.close();
      await pmbApp.close();
      await db.$disconnect();
    },
    async reset() {
      await db.$executeRawUnsafe(`TRUNCATE ${TRANSACTIONAL_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
      await db.channel.updateMany({ data: { aiPaused: false, aiPausedReason: null, aiPausedBy: null, aiPausedAt: null } });
      clock.set(MONDAY_10);
      spy.mode = "normal";
      mailer.sent.length = 0;
      realtime.staff.length = 0;
      realtime.customer.length = 0;
      ctx.params.invalidate();
      await seed(ctx, PASSWORD);
      spy.calls = []; // drop the seed's KB test calls
    },
    async login(email: string) {
      const res = await http.post("/api/auth/login").send({ email, password: PASSWORD });
      if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      const cookie = res.headers["set-cookie"] as unknown as string[];
      const csrf = res.body.csrfToken as string;
      return {
        csrf,
        userId: res.body.user.id,
        get: (p: string) => http.get(p).set("Cookie", cookie),
        post: (p: string, body?: object) => http.post(p).set("Cookie", cookie).set("x-csrf-token", csrf).send(body ?? {}),
      };
    },
    async customer() {
      const s = await http.post("/public/web/session").send({});
      const token = s.body.token as string;
      await http.post("/public/consents").set("authorization", `Bearer ${token}`).send({ service: true });
      return {
        token,
        ask: (text: string) => http.post("/public/messages").set("authorization", `Bearer ${token}`).send({ text }),
        control: (controlId: string) => http.post("/public/control").set("authorization", `Bearer ${token}`).send({ controlId }),
        me: async () => (await http.get("/public/me").set("authorization", `Bearer ${token}`)).body,
      };
    },
    async wa(phone, body) {
      const r = await http.post("/sim/whatsapp/send").send({ from: phone, name: "Sim DUMMY", ...body });
      if (r.status !== 200) throw new Error(`wa send failed ${r.status} ${JSON.stringify(r.body)}`);
    },
    async waOutbox(phone) {
      return (await http.get(`/sim/whatsapp/outbox?to=${phone}`)).body.items.map((i: any) => i.payload);
    },
    async sim(channel, from, body) {
      const r = await http.post(`/sim/${channel}/send`).send({ from, name: "Sim DUMMY", ...body });
      if (r.status !== 200) throw new Error(`sim ${channel} failed ${r.status} ${JSON.stringify(r.body)}`);
    },
    async outbox(channel, to) {
      return (await http.get(`/sim/${channel}/outbox?to=${encodeURIComponent(to)}`)).body.items.map((i: any) => readPayload(channel, i.payload));
    },
    lastOtp() {
      const m = mailer.sent.at(-1)?.text.match(/(\d{6})/);
      if (!m) throw new Error("no OTP mail");
      return m[1]!;
    },
  };
  return h;
}

export const STAFF = "staf1@dummy.halokampus.local";
export const STAFF2 = "staf2@dummy.halokampus.local";
export const CP = "cp1@dummy.halokampus.local";
export const CP2 = "cp2@dummy.halokampus.local";
export const LEADER = "pimpinan@dummy.halokampus.local";
export const FINANCE = "keuangan@dummy.halokampus.local";
export const ADMIN = "admin@dummy.halokampus.local";

/** DUMMY question that the mock pipeline answers with C ≥ 0.75. */
export const ANSWERABLE = "Jalur pendaftaran apa saja yang tersedia?";
/** DUMMY question that scores just below 0.75 with the mock embedder (C = 0.7481). */
export const LOW_CONFIDENCE = "Berapa biaya pendaftaran?";
