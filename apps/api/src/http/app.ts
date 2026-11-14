import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import type { Ctx } from "../context.js";
import { registerAuth, sendError } from "./auth.js";
import { registerGovernanceRoutes } from "./routes/governance.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerStaffRoutes } from "./routes/staff.js";

export async function buildApp(ctx: Ctx, opts: { logger?: boolean; logStream?: NodeJS.WritableStream } = {}) {
  const app = Fastify({ logger: opts.logger ? { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-csrf-token\"]"], ...(opts.logStream ? { stream: opts.logStream } : {}) } : false, trustProxy: true, bodyLimit: 1024 * 1024 });

  // Keep the raw JSON body for webhook signature verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      (e as { statusCode?: number }).statusCode = 400;
      done(e as Error, undefined);
    }
  });

  // Route registry used by the automated RBAC matrix test (Phase 4).
  const routes: Array<{ method: string; url: string; auth: string; permission?: string; customerPurpose?: unknown }> = [];
  app.addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) if (m !== "HEAD") routes.push({ method: String(m), url: r.url, auth: r.config?.auth ?? "public", permission: r.config?.permission, customerPurpose: r.config?.customerPurpose });
  });
  app.decorate("routeRegistry", routes);

  await app.register(cookie);
  await app.register(cors, { origin: ctx.env.CORS_ORIGINS.split(",").map((s) => s.trim()), credentials: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false, allowList: () => ctx.env.DISABLE_RATE_LIMIT });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (ctx.env.COOKIE_SECURE) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    if (!reply.hasHeader("content-disposition")) reply.header("cache-control", "no-store");
  });
  app.setErrorHandler((err, _req, reply) => sendError(reply, err));

  app.get("/health", async () => ({ ok: true, product: "haloK@MPUS" }));
  registerAuth(app, ctx);
  registerStaffRoutes(app, ctx);
  registerGovernanceRoutes(app, ctx);
  registerPublicRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerAnalyticsRoutes(app, ctx);
  return app;
}
