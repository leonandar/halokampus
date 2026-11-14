import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createContext, refreshLlmChains } from "./bootstrap.js";
import { loadEnv, productionProblems } from "./env.js";
import { processInboundMessage } from "./services/pipeline.js";
import { runReminders } from "./services/reminders.js";
import { processDueTimers, processInactivity } from "./services/tickets.js";
import { runRetention } from "./services/governance.js";
import { weeklyReports } from "./services/reports.js";

/**
 * Worker process (ADR-02): AI pipeline jobs, the SLA sweep (every 15 s), and the daily
 * proactive reminders. Set REALTIME_REDIS=true on both API and worker so events emitted
 * here reach the consoles and widgets through the Socket.IO Redis adapter.
 */
const env = loadEnv();
const problems = productionProblems(env);
if (problems.length) {
  console.error(`[haloK@MPUS] Konfigurasi produksi tidak aman:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const { redisEmitterRealtime } = await import("./realtime.js");
const ctx = await createContext(env, env.REALTIME_REDIS ? { realtime: redisEmitterRealtime(env.REDIS_URL) } : {});

new Worker(
  "ai",
  async (job) => {
    await refreshLlmChains(ctx);
    await processInboundMessage(ctx, String(job.data.messageId));
  },
  { connection, concurrency: 8 },
);

const maint = new Queue("maintenance", { connection });
await maint.upsertJobScheduler("sla-sweep", { every: 15_000 }, { name: "sla-sweep" });
await maint.upsertJobScheduler("reminders", { pattern: "0 9 * * *", tz: "Asia/Jakarta" }, { name: "reminders" });
await maint.upsertJobScheduler("inactivity", { every: 60_000 }, { name: "inactivity" });
await maint.upsertJobScheduler("retention", { pattern: "30 1 * * *", tz: "Asia/Jakarta" }, { name: "retention" });
await maint.upsertJobScheduler("weekly-report", { pattern: "0 6 * * 1", tz: "Asia/Jakarta" }, { name: "weekly-report" });
new Worker(
  "maintenance",
  async (job) => {
    if (job.name === "sla-sweep") return processDueTimers(ctx);
    if (job.name === "reminders") return runReminders(ctx);
    if (job.name === "inactivity") return processInactivity(ctx);
    if (job.name === "retention") return runRetention(ctx);
    if (job.name === "weekly-report") return weeklyReports(ctx);
  },
  { connection },
);
console.log("[worker] haloK@MPUS worker started");
