/**
 * haloK@MPUS peak-load test (NFR-01, NFR-03). Usage:
 *   pnpm loadtest -- --rate 5 --duration 60 --customers 300
 * Starts mock-pmb + API (AI_INLINE, mock LLM) on a dedicated database `halokampus_load`,
 * sends web-chat messages at the target rate, then measures — from the `events` table —
 * the time from each customer message to the first reply (AI answer or hand-off card).
 * The mock LLM is near-instant: results describe the application layer, not an LLM.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@hk/db";

const arg = (k: string, d: number) => Number(process.argv.find((a, i) => process.argv[i - 1] === `--${k}`) ?? d);
const RATE = arg("rate", 5);
const DURATION = arg("duration", 60);
const CUSTOMERS = arg("customers", 300);
const API = "http://localhost:4000";

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const DB = env.DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, "/halokampus_load$1");
const childEnv = { ...process.env, ...env, DATABASE_URL: DB, DISABLE_RATE_LIMIT: "true", AI_INLINE: "true", ENABLE_SIMULATORS: "true", CONFIG_DIR: "../../config" };

const QUESTIONS = ["Jalur pendaftaran apa saja yang tersedia?", "Kapan jadwal tes seleksi jalur mandiri?", "Kapan pengumuman hasil seleksi jalur mandiri?", "Berapa biaya pendaftaran?", "Berkas wajib apa saja yang diunggah?", "Pembayaran saya gagal tapi saldo terpotong"];
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! : NaN);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function main() {
  console.log(`[load] preparing database halokampus_load …`);
  execSync(`docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -tc "SELECT 1 FROM pg_database WHERE datname='halokampus_load'" | grep -q 1 || docker exec halokampus-postgres-1 psql -U halokampus -d halokampus -c "CREATE DATABASE halokampus_load"`, { stdio: "ignore", shell: "/bin/bash" });
  execSync("npx prisma migrate deploy", { cwd: "packages/db", env: childEnv, stdio: "ignore" });
  const db = new PrismaClient({ datasources: { db: { url: DB } } });
  const tables = await db.$queryRawUnsafe<Array<{ tablename: string }>>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('roles','channels','sla_policies','_prisma_migrations')`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  execSync("npx tsx src/scripts/seed.ts", { cwd: "apps/api", env: childEnv, stdio: "ignore" });

  const procs: ChildProcess[] = [
    spawn("pnpm", ["--filter", "@hk/mock-pmb", "start"], { env: childEnv, stdio: "ignore", detached: true }),
    spawn("npx", ["tsx", "src/server.ts"], { cwd: "apps/api", env: childEnv, stdio: "ignore", detached: true }),
  ];
  try {
    await waitFor(`${API}/health`);
    console.log(`[load] creating ${CUSTOMERS} web customers (consent given) …`);
    const tokens: string[] = [];
    for (let i = 0; i < CUSTOMERS; i++) {
      const s = (await (await fetch(`${API}/public/web/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()) as { token: string };
      await fetch(`${API}/public/consents`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` }, body: JSON.stringify({ service: true }) });
      tokens.push(s.token);
    }
    const total = RATE * DURATION;
    console.log(`[load] sending ${total} messages at ${RATE}/s for ${DURATION}s …`);
    const httpMs: number[] = [];
    let errors = 0;
    const started = Date.now();
    const inflight: Promise<void>[] = [];
    for (let i = 0; i < total; i++) {
      const due = started + (i * 1000) / RATE;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
      const token = tokens[i % tokens.length]!;
      const text = QUESTIONS[i % QUESTIONS.length]!;
      inflight.push(
        (async () => {
          const t0 = performance.now();
          const r = await fetch(`${API}/public/messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ text }) }).catch(() => null);
          httpMs.push(performance.now() - t0);
          if (!r || !r.ok) errors++;
        })(),
      );
    }
    await Promise.all(inflight);
    const sendSeconds = (Date.now() - started) / 1000;
    console.log("[load] waiting for the pipeline to drain …");
    await sleep(8000);

    // Response time per customer message, from events (same source as the KPIs).
    const rows = await db.$queryRawUnsafe<Array<{ ms: number }>>(`
      SELECT EXTRACT(EPOCH FROM (r.occurred_at - m.occurred_at)) * 1000 AS ms
        FROM events m
        JOIN LATERAL (
          SELECT occurred_at FROM events s
           WHERE s.ticket_id = m.ticket_id AND s.type = 'message_sent' AND s.occurred_at >= m.occurred_at AND s.seq > m.seq
           ORDER BY s.seq LIMIT 1) r ON true
       WHERE m.type = 'message_received' AND m.ticket_id IS NOT NULL`);
    const replyMs = rows.map((r) => Number(r.ms));
    const received = await db.event.count({ where: { type: "message_received" } });
    const aiLatency = (await db.event.findMany({ where: { type: "ai_answer_sent" }, select: { payload: true } })).map((e) => Number((e.payload as { latencyMs?: number }).latencyMs)).filter(Number.isFinite);
    const sla = await db.slaTimer.groupBy({ by: ["tier", "state"], _count: true });
    const result = {
      generatedAt: new Date().toISOString(),
      target: { rate: RATE, durationSeconds: DURATION, customers: CUSTOMERS, messages: total },
      achievedRatePerSecond: Number((total / sendSeconds).toFixed(2)),
      httpErrors: errors,
      httpMs: { p50: pct(httpMs, 50), p95: pct(httpMs, 95), max: Math.max(...httpMs) },
      messagesReceived: received,
      messagesWithReply: replyMs.length,
      replyMs: { p50: pct(replyMs, 50), p95: pct(replyMs, 95), p99: pct(replyMs, 99), max: Math.max(...replyMs) },
      aiPipelineMs: { p50: pct(aiLatency, 50), p95: pct(aiLatency, 95), n: aiLatency.length },
      nfr01_p95_within_5s: pct(replyMs, 95) <= 5000,
      slaTimers: sla.map((s) => ({ tier: s.tier, state: s.state, n: s._count })),
    };
    const round = (o: unknown): unknown => (typeof o === "number" ? Math.round(o * 10) / 10 : Array.isArray(o) ? o.map(round) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) : o);
    const out = round(result);
    writeFileSync(`docs/loadtest-result-${RATE}rps.json`, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await db.$disconnect();
  } finally {
    // Kill each child's whole process group (pnpm/npx spawn grandchildren).
    for (const p of procs) if (p.pid) try { process.kill(-p.pid, "SIGTERM"); } catch {}
  }
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
