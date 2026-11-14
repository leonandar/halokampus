import { hash } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";
import { CHANNELS, OVERRIDE_CAUSES, ROLES, type ChannelCode, type OverrideCause, type OverrideType, type Role } from "@hk/shared";
import type { Ctx } from "../../context.js";
import { HttpError } from "../auth.js";
import { appendAudit } from "../../services/ledger.js";
import { actionView } from "../../services/pipeline.js";
import { overrideAiAction, setAiPause } from "../../services/supervision.js";
import { createKbDocument, publishKbDocument, testKbDocument } from "../../services/kb.js";

export function registerGovernanceRoutes(app: FastifyInstance, ctx: Ctx) {
  // ------------------------------------------------------------ supervision (staff only)
  app.get<{ Querystring: { limit?: string; channel?: string } }>("/api/supervision/feed", { config: { auth: "staff", permission: "ai.supervise" } }, async (req) => {
    const rows = await ctx.db.aiAction.findMany({
      where: req.query.channel ? { channelCode: req.query.channel } : {},
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Number(req.query.limit ?? 50)),
      select: { id: true },
    });
    return { items: await Promise.all(rows.map((r) => actionView(ctx, r.id))), causes: OVERRIDE_CAUSES };
  });

  app.post<{ Params: { id: string }; Body: { type?: OverrideType; cause?: OverrideCause; reason?: string; replacement?: string; notifyCustomer?: boolean } }>(
    "/api/ai-actions/:id/override",
    { config: { auth: "staff", permission: "ai.override" } },
    async (req) => {
      const b = req.body ?? {};
      const ov = await overrideAiAction(ctx, { aiActionId: req.params.id, user: req.staff!, type: b.type as OverrideType, cause: b.cause as OverrideCause, reason: String(b.reason ?? ""), replacement: b.replacement, notifyCustomer: Boolean(b.notifyCustomer) });
      return { ok: true, overrideId: ov.id };
    },
  );

  app.get("/api/channels", { config: { auth: "staff", permission: "ai.supervise" } }, async () => ({ items: await ctx.db.channel.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, enabled: true, aiPaused: true, aiPausedReason: true, aiPausedAt: true } }) }));

  app.post<{ Body: { channel?: string; paused?: boolean; reason?: string } }>("/api/ai/pause", { config: { auth: "staff", permission: "ai.pause" } }, async (req) => {
    const channel = String(req.body?.channel ?? "");
    if (channel !== "all" && !(CHANNELS as readonly string[]).includes(channel)) throw new HttpError(400, "invalid_channel", "Kanal tidak dikenal");
    await setAiPause(ctx, { channel: channel as ChannelCode | "all", paused: Boolean(req.body?.paused), reason: String(req.body?.reason ?? ""), user: req.staff! });
    return { ok: true };
  });

  // ------------------------------------------------------------ audit trail (read-only)
  app.get<{ Querystring: { resourceType?: string; resourceId?: string; limit?: string } }>("/api/audit", { config: { auth: "staff", permission: "audit.read" } }, async (req) => {
    const where: Record<string, string> = {};
    if (req.query.resourceType) where.resourceType = req.query.resourceType;
    if (req.query.resourceId) where.resourceId = req.query.resourceId;
    const rows = await ctx.db.auditLog.findMany({ where, orderBy: { seq: "desc" }, take: Math.min(500, Number(req.query.limit ?? 100)) });
    const users = new Map((await ctx.db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return { items: rows.map((r) => ({ seq: r.seq.toString(), at: r.at.toISOString(), actorType: r.actorType, actorName: r.actorId ? users.get(r.actorId) ?? r.actorId : null, actorRole: r.actorRole, action: r.action, resourceType: r.resourceType, resourceId: r.resourceId, detail: r.detail, hash: r.hash.slice(0, 12) })) };
  });

  // ------------------------------------------------------------ knowledge base
  app.get("/api/kb", { config: { auth: "staff", permission: "kb.read" } }, async () => {
    const docs = await ctx.db.kbDocument.findMany({ orderBy: [{ slug: "asc" }, { version: "desc" }], include: { _count: { select: { chunks: true } } } });
    return { items: docs.map((d) => ({ id: d.id, slug: d.slug, title: d.title, version: d.version, status: d.status, effectiveFrom: d.effectiveFrom?.toISOString().slice(0, 10) ?? null, effectiveTo: d.effectiveTo?.toISOString().slice(0, 10) ?? null, chunks: d._count.chunks, testedAt: d.testedAt?.toISOString() ?? null, testReport: d.testReport, publishedAt: d.publishedAt?.toISOString() ?? null, isDummy: d.isDummy })) };
  });
  app.post<{ Body: { slug?: string; markdown?: string } }>("/api/kb", { config: { auth: "staff", permission: "kb.manage" } }, async (req) => {
    const slug = String(req.body?.slug ?? "").trim();
    if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new HttpError(400, "invalid_slug", "Slug hanya huruf kecil, angka, dan tanda hubung");
    return createKbDocument(ctx, { slug, markdown: String(req.body?.markdown ?? ""), userId: req.staff!.id });
  });
  app.post<{ Params: { id: string }; Body: { questions?: string[] } }>("/api/kb/:id/test", { config: { auth: "staff", permission: "kb.manage" } }, async (req) => testKbDocument(ctx, { documentId: req.params.id, questions: (req.body?.questions ?? []).map(String).filter(Boolean), userId: req.staff!.id }));
  app.post<{ Params: { id: string } }>("/api/kb/:id/publish", { config: { auth: "staff", permission: "kb.manage" } }, async (req) => {
    await publishKbDocument(ctx, { documentId: req.params.id, userId: req.staff!.id });
    return { ok: true };
  });

  // ------------------------------------------------------------ policy parameters (FR-37)
  app.get("/api/params", { config: { auth: "staff", permission: "params.read" } }, async () => {
    const rows = await ctx.params.list();
    return { items: rows.map((r) => ({ id: r.id, code: r.code, version: r.version, value: r.value, status: r.status, source: r.source, label: r.label, reason: r.reason, proposedBy: r.proposedBy, proposedRole: r.proposedRole, approvedBy: r.approvedBy, approvedRole: r.approvedRole, effectiveFrom: r.effectiveFrom?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })) };
  });
  app.post<{ Body: { code?: string; value?: unknown; reason?: string } }>("/api/params/proposals", { config: { auth: "staff", permission: "params.propose" } }, async (req) => {
    const row = await ctx.params.propose({ code: String(req.body?.code ?? ""), value: req.body?.value, reason: String(req.body?.reason ?? ""), userId: req.staff!.id, role: req.staff!.role });
    return { id: row.id, version: row.version };
  });
  app.post<{ Params: { id: string } }>("/api/params/proposals/:id/approve", { config: { auth: "staff", permission: "params.approve" } }, async (req) => {
    const row = await ctx.params.approve({ id: req.params.id, userId: req.staff!.id, role: req.staff!.role });
    return { ok: true, code: row.code, version: row.version };
  });

  // ------------------------------------------------------------ admin (no conversation access)
  app.get("/api/admin/users", { config: { auth: "staff", permission: "users.manage" } }, async () => ({
    items: await ctx.db.user.findMany({ orderBy: { email: "asc" }, select: { id: true, email: true, name: true, roleCode: true, active: true, totpEnabled: true, presence: true, isDummy: true } }),
  }));
  app.post<{ Body: { email?: string; name?: string; role?: string; password?: string } }>("/api/admin/users", { config: { auth: "staff", permission: "users.manage" } }, async (req) => {
    const b = req.body ?? {};
    const email = String(b.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, "invalid_email", "Email tidak valid");
    if (!(ROLES as readonly string[]).includes(String(b.role))) throw new HttpError(400, "invalid_role", "Peran tidak dikenal");
    if (String(b.password ?? "").length < 10) throw new HttpError(400, "weak_password", "Kata sandi minimal 10 karakter");
    const user = await ctx.db.user.create({ data: { email, name: String(b.name ?? email), roleCode: b.role as Role, passwordHash: await hash(String(b.password)) } });
    await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: req.staff!.id, actorRole: "admin", action: "user.create", resourceType: "user", resourceId: user.id, detail: { role: b.role } });
    return { id: user.id };
  });
  // Channel integrations (FR-42): on/off per channel; credentials stay in the server environment.
  app.get("/api/admin/channels", { config: { auth: "staff", permission: "channels.manage" } }, async () => {
    const env = ctx.env;
    const mode: Record<string, string> = { web: "aktif", whatsapp: env.WHATSAPP_MODE, instagram: env.META_MODE, messenger: env.META_MODE, telegram: env.TELEGRAM_MODE, email: env.EMAIL_MODE, phone: "pencatatan petugas" };
    const configured: Record<string, boolean> = {
      web: true,
      whatsapp: env.WHATSAPP_MODE === "simulator" || Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID),
      instagram: env.META_MODE === "simulator" || Boolean(env.META_PAGE_ACCESS_TOKEN),
      messenger: env.META_MODE === "simulator" || Boolean(env.META_PAGE_ACCESS_TOKEN),
      telegram: env.TELEGRAM_MODE === "simulator" || Boolean(env.TELEGRAM_BOT_TOKEN),
      email: true,
      phone: true,
    };
    const rows = await ctx.db.channel.findMany({ orderBy: { code: "asc" } });
    return { items: rows.map((c) => ({ code: c.code, name: c.name, enabled: c.enabled, mode: mode[c.code], configured: configured[c.code], webhookSecured: c.code === "whatsapp" ? Boolean(env.WHATSAPP_APP_SECRET) : ["instagram", "messenger"].includes(c.code) ? Boolean(env.META_APP_SECRET) : c.code === "telegram" ? Boolean(env.TELEGRAM_WEBHOOK_SECRET) : c.code === "email" ? Boolean(env.EMAIL_WEBHOOK_TOKEN) : null })) };
  });
  app.post<{ Params: { code: string }; Body: { enabled?: boolean } }>("/api/admin/channels/:code", { config: { auth: "staff", permission: "channels.manage" } }, async (req) => {
    if (!(CHANNELS as readonly string[]).includes(req.params.code)) throw new HttpError(404, "not_found", "Kanal tidak dikenal");
    const enabled = Boolean(req.body?.enabled);
    await ctx.db.channel.update({ where: { code: req.params.code }, data: { enabled } });
    const now = ctx.clock.now();
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: req.staff!.id, actorRole: "admin", action: enabled ? "channel.enable" : "channel.disable", resourceType: "channel", resourceId: req.params.code });
    await (await import("../../services/ledger.js")).appendEvent(ctx.db, { occurredAt: now, type: "channel_toggled", channel: req.params.code, actorType: "admin", actorId: req.staff!.id, payload: { enabled } });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { active?: boolean } }>("/api/admin/users/:id/active", { config: { auth: "staff", permission: "users.manage" } }, async (req) => {
    await ctx.db.user.update({ where: { id: req.params.id }, data: { active: Boolean(req.body?.active) } });
    if (!req.body?.active) await ctx.db.staffSession.deleteMany({ where: { userId: req.params.id } });
    await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: req.staff!.id, actorRole: "admin", action: req.body?.active ? "user.activate" : "user.deactivate", resourceType: "user", resourceId: req.params.id });
    return { ok: true };
  });
}
