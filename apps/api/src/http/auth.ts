import { verify } from "@node-rs/argon2";
import { authenticator } from "otplib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { roleHas, type Permission, type Role } from "@hk/shared";
import type { Ctx } from "../context.js";
import { randomToken, sha256 } from "../crypto.js";
import { appendAudit } from "../services/ledger.js";

export interface StaffPrincipal {
  id: string;
  role: Role;
  name: string;
  email: string;
  presence: string;
  sessionId: string;
  csrfToken: string;
}

export interface CustomerPrincipal {
  customerId: string;
  channel: string;
  purpose: string;
}

declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffPrincipal;
    customer?: CustomerPrincipal;
  }
  interface FastifyContextConfig {
    /** "staff" routes need a session; "customer" routes a bearer token; "public" none. */
    auth?: "staff" | "customer" | "public";
    permission?: Permission;
    customerPurpose?: "chat" | "data_rights" | "upload" | Array<"chat" | "data_rights" | "upload">;
  }
}

export const SESSION_COOKIE = "hk_session";
const SESSION_TTL_MS = 10 * 3600_000; // one working shift
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Throws 403 and writes an `authz_denied` audit entry (KB-06). Used by the hook and by handlers. */
export async function requirePermission(ctx: Ctx, req: FastifyRequest, permission: Permission): Promise<void> {
  const s = req.staff;
  if (!s) throw new HttpError(401, "unauthenticated", "Silakan masuk terlebih dahulu");
  if (!roleHas(s.role, permission)) {
    await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: s.id, actorRole: s.role, action: "authz_denied", resourceType: "route", resourceId: `${req.method} ${req.routeOptions.url}`, detail: { permission } });
    throw new HttpError(403, "forbidden", "Di luar kewenangan peran Anda");
  }
}

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  // ------------------------------------------------------------ request hook
  app.addHook("preHandler", async (req) => {
    const cfg = req.routeOptions.config;
    const mode = cfg?.auth ?? "public";
    if (mode === "staff") {
      const token = req.cookies[SESSION_COOKIE];
      if (!token) throw new HttpError(401, "unauthenticated", "Silakan masuk terlebih dahulu");
      const session = await ctx.db.staffSession.findUnique({ where: { id: sha256(token) }, include: { user: true } });
      if (!session || session.expiresAt < ctx.clock.now() || !session.user.active) throw new HttpError(401, "unauthenticated", "Sesi berakhir, silakan masuk kembali");
      req.staff = { id: session.user.id, role: session.user.roleCode as Role, name: session.user.name, email: session.user.email, presence: session.user.presence, sessionId: session.id, csrfToken: session.csrfToken };
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-csrf-token"] !== session.csrfToken) {
        throw new HttpError(403, "csrf", "Token CSRF tidak valid");
      }
      if (cfg?.permission) await requirePermission(ctx, req, cfg.permission);
    } else if (mode === "customer") {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
      if (!token) throw new HttpError(401, "unauthenticated", "Sesi tidak ditemukan");
      const s = await ctx.db.customerSession.findUnique({ where: { id: sha256(token) } });
      if (!s || s.expiresAt < ctx.clock.now()) throw new HttpError(401, "unauthenticated", "Sesi berakhir");
      if (cfg?.customerPurpose && !([] as string[]).concat(cfg.customerPurpose).includes(s.purpose)) throw new HttpError(403, "forbidden", "Token tidak berlaku untuk halaman ini");
      req.customer = { customerId: s.customerId, channel: s.channelCode, purpose: s.purpose };
    }
  });

  // ------------------------------------------------------------ login/logout
  app.post<{ Body: { email?: string; password?: string; totp?: string } }>("/api/auth/login", { config: { auth: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const now = ctx.clock.now();
    const user = await ctx.db.user.findUnique({ where: { email } });
    const fail = async (reason: string) => {
      if (user) {
        const failed = user.failedLogins + 1;
        await ctx.db.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(now.getTime() + LOCK_MS) : user.lockedUntil } });
      }
      await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user?.id ?? null, action: "auth.login_failed", detail: { reason } });
      throw new HttpError(401, "invalid_credentials", "Email atau kata sandi salah");
    };
    if (!user || !user.active) return fail("unknown_or_inactive");
    if (user.lockedUntil && user.lockedUntil > now) throw new HttpError(423, "locked", "Akun dikunci sementara karena terlalu banyak percobaan gagal");
    if (!(await verify(user.passwordHash, password))) return fail("password");
    if (user.totpEnabled) {
      if (!req.body?.totp) throw new HttpError(401, "totp_required", "Masukkan kode 2FA");
      const secret = ctx.crypto.decrypt(user.totpSecretEnc!);
      if (!authenticator.check(String(req.body.totp), secret)) return fail("totp");
    }
    const token = randomToken();
    const csrfToken = randomToken(18);
    await ctx.db.staffSession.create({ data: { id: sha256(token), userId: user.id, csrfToken, twoFactorOk: user.totpEnabled, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) } });
    await ctx.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: user.id, actorRole: user.roleCode, action: "auth.login" });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: ctx.env.COOKIE_SECURE, path: "/", maxAge: SESSION_TTL_MS / 1000 });
    return { user: { id: user.id, name: user.name, email: user.email, role: user.roleCode, presence: user.presence, totpEnabled: user.totpEnabled }, csrfToken };
  });

  app.post("/api/auth/logout", { config: { auth: "staff" } }, async (req, reply) => {
    await ctx.db.staffSession.delete({ where: { id: req.staff!.sessionId } }).catch(() => undefined);
    await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: req.staff!.id, actorRole: req.staff!.role, action: "auth.logout" });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { config: { auth: "staff" } }, async (req) => {
    const s = req.staff!;
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: s.id } });
    return { user: { id: s.id, name: s.name, email: s.email, role: s.role, presence: user.presence, totpEnabled: user.totpEnabled }, csrfToken: s.csrfToken };
  });

  // ------------------------------------------------------------ optional 2FA
  app.post("/api/auth/2fa/setup", { config: { auth: "staff" } }, async (req) => {
    const secret = authenticator.generateSecret();
    await ctx.db.user.update({ where: { id: req.staff!.id }, data: { totpSecretEnc: ctx.crypto.encrypt(secret), totpEnabled: false } });
    return { secret, otpauth: authenticator.keyuri(req.staff!.email, "haloK@MPUS", secret) };
  });

  app.post<{ Body: { code?: string } }>("/api/auth/2fa/enable", { config: { auth: "staff" } }, async (req) => {
    const user = await ctx.db.user.findUniqueOrThrow({ where: { id: req.staff!.id } });
    if (!user.totpSecretEnc || !authenticator.check(String(req.body?.code ?? ""), ctx.crypto.decrypt(user.totpSecretEnc))) {
      throw new HttpError(400, "invalid_code", "Kode 2FA tidak valid");
    }
    await ctx.db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
    await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: user.id, actorRole: user.roleCode, action: "auth.2fa_enabled" });
    return { ok: true };
  });
}

export function sendError(reply: FastifyReply, err: unknown) {
  const e = err as { status?: number; statusCode?: number; code?: string; message?: string; validation?: unknown; name?: string };
  // Prisma: missing record → 404; malformed id/input → 400 (never a 500 for bad client input).
  if (e.code === "P2025") return reply.code(404).send({ error: "not_found", message: "Data tidak ditemukan" });
  if (e.code === "P2023" || e.name === "PrismaClientValidationError" || (typeof e.message === "string" && /invalid input syntax for type uuid|Error creating UUID/i.test(e.message))) {
    return reply.code(400).send({ error: "bad_request", message: "Permintaan tidak valid" });
  }
  const status = e.status ?? (e.validation ? 400 : e.statusCode && e.statusCode < 500 ? e.statusCode : 500);
  if (status >= 500) console.error("[api] unhandled", err);
  return reply.code(status).send({ error: e.code && typeof e.code === "string" && status < 500 ? e.code : status >= 500 ? "internal" : "bad_request", message: status >= 500 ? "Terjadi kesalahan pada server" : e.message });
}
