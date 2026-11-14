import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Emitter } from "@socket.io/redis-emitter";
import { Redis } from "ioredis";
import { ROLES, type Role } from "@hk/shared";
import type { Ctx, Realtime } from "./context.js";
import { sha256 } from "./crypto.js";
import { SESSION_COOKIE } from "./http/auth.js";

function parseCookies(header: string | undefined): Record<string, string> {
  return Object.fromEntries((header ?? "").split(";").map((p) => p.trim().split("=")).filter((kv) => kv.length === 2).map(([k, v]) => [k!, decodeURIComponent(v!)]));
}

/**
 * Socket.IO fan-out (NFR-02). `/staff` authenticates with the session cookie and joins
 * one room per role; `/customer` authenticates with the widget bearer token. Roles that
 * must not read conversations (admin, leader) never receive message events.
 */
export function attachRealtime(server: HttpServer, ctx: Ctx): Realtime {
  const io = new Server(server, { cors: { origin: ctx.env.CORS_ORIGINS.split(","), credentials: true }, path: "/socket.io" });
  // With a separate worker process, events emitted there reach these sockets through Redis.
  if (ctx.env.REALTIME_REDIS) {
    const pub = new Redis(ctx.env.REDIS_URL);
    io.adapter(createAdapter(pub, pub.duplicate()));
  }

  io.of("/staff").use(async (socket, next) => {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    const s = token ? await ctx.db.staffSession.findUnique({ where: { id: sha256(token) }, include: { user: true } }) : null;
    if (!s || s.expiresAt < new Date() || !s.user.active) return next(new Error("unauthenticated"));
    socket.data.role = s.user.roleCode;
    socket.data.userId = s.user.id;
    next();
  });
  io.of("/staff").on("connection", (socket) => {
    socket.join(`role:${socket.data.role as string}`);
    socket.join(`user:${socket.data.userId as string}`);
  });

  io.of("/customer").use(async (socket, next) => {
    const token = String(socket.handshake.auth?.token ?? "");
    const s = token ? await ctx.db.customerSession.findUnique({ where: { id: sha256(token) } }) : null;
    if (!s || s.expiresAt < new Date() || s.purpose !== "chat") return next(new Error("unauthenticated"));
    socket.data.customerId = s.customerId;
    next();
  });
  io.of("/customer").on("connection", (socket) => socket.join(`customer:${socket.data.customerId as string}`));

  const DEFAULT_ROLES: Role[] = ["cp", "staff"];
  return {
    toStaff(event, payload, opts) {
      const roles = (opts?.roles ?? DEFAULT_ROLES).filter((r) => (ROLES as readonly string[]).includes(r));
      let target = io.of("/staff").to(`role:${roles[0]}`);
      for (const r of roles.slice(1)) target = target.to(`role:${r}`);
      target.emit(event, payload);
    },
    toCustomer(customerId, event, payload) {
      io.of("/customer").to(`customer:${customerId}`).emit(event, payload);
    },
  };
}

/** Real-time sender for the worker process (no HTTP server): publishes through Redis (ADR-02). */
export function redisEmitterRealtime(redisUrl: string): Realtime {
  const emitter = new Emitter(new Redis(redisUrl));
  return {
    toStaff(event, payload, opts) {
      const roles = opts?.roles ?? ["cp", "staff"];
      emitter.of("/staff").to(roles.map((r) => `role:${r}`)).emit(event, payload);
    },
    toCustomer(customerId, event, payload) {
      emitter.of("/customer").to(`customer:${customerId}`).emit(event, payload);
    },
  };
}
