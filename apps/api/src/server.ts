import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { createContext, refreshLlmChains } from "./bootstrap.js";
import { loadEnv, productionProblems } from "./env.js";
import { buildApp } from "./http/app.js";
import { attachRealtime } from "./realtime.js";
import { processDueTimers, processInactivity } from "./services/tickets.js";
import { processInboundMessage } from "./services/pipeline.js";
import type { Realtime } from "./context.js";

const env = loadEnv();
const problems = productionProblems(env);
if (problems.length) {
  console.error(`[haloK@MPUS] Konfigurasi produksi tidak aman:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
let realtime: Realtime = { toStaff() {}, toCustomer() {} };
const proxy: Realtime = { toStaff: (...a) => realtime.toStaff(...a), toCustomer: (...a) => realtime.toCustomer(...a) };

const queue = env.AI_INLINE ? null : new Queue("ai", { connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) });
const ctx = await createContext(env, {
  realtime: proxy,
  dispatchAi: async (c, id) => {
    if (queue) {
      await queue.add("process", { messageId: id }, { removeOnComplete: 1000, removeOnFail: 1000 });
    } else {
      await refreshLlmChains(c);
      // Inline mode still answers asynchronously so the HTTP request returns at once.
      void processInboundMessage(c, id).catch((e) => console.error("[ai] pipeline error", e));
    }
  },
});
const app = await buildApp(ctx, { logger: true });
await app.ready();
realtime = attachRealtime(app.server, ctx);
await app.listen({ port: env.API_PORT, host: "0.0.0.0" });

if (env.AI_INLINE) {
  // Without a worker process, run the SLA sweep here (every 5 s).
  setInterval(() => void processDueTimers(ctx).catch((e) => console.error("[sla] sweep error", e)), 5000);
  setInterval(() => void processInactivity(ctx).catch((e) => console.error("[inactivity] error", e)), 60_000);
}
console.log(`[api] haloK@MPUS API on :${env.API_PORT} (AI_INLINE=${env.AI_INLINE}, providers=${ctx.llm.providerIds().join(",")}, embedding=${ctx.embedder.id})`);
