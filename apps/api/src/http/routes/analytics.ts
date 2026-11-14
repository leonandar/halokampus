import type { FastifyInstance, FastifyReply } from "fastify";
import { DSR_TYPES, type DsrType } from "@hk/shared";
import { maskName } from "@hk/domain";
import type { Ctx } from "../../context.js";
import { HttpError } from "../auth.js";
import { kpiReport, parsePeriod } from "../../services/kpi.js";
import { auditExport, researchExport } from "../../services/exports.js";
import { generateReport } from "../../services/reports.js";
import { closeCycle, cpOverview, currentCycle, giveCpFeedback, handleDsr, qaSample, releaseTicket, returnToCp, runRetention, submitQaReview, updateCycleItem } from "../../services/governance.js";
import { answerUsability, usabilitySurveys } from "../../services/surveys.js";
import { createKbDocument } from "../../services/kb.js";
import { fileToText, textToKbMarkdown } from "../../services/kb-files.js";
import { profileOf } from "../../services/customers.js";

type Q = { from?: string; to?: string; channel?: string; category?: string; tier?: string; agent?: string; includeDummy?: string };

function download(reply: FastifyReply, body: Buffer, filename: string, type: string) {
  return reply.header("content-type", type).header("content-disposition", `attachment; filename="${filename}"`).send(body);
}
const TYPES = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf", json: "application/json" };

export function registerAnalyticsRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------------------------------------------------------------- KPI (FR-38/60)
  app.get<{ Querystring: Q }>("/api/kpi", { config: { auth: "staff", permission: "kpi.read" } }, async (req) => {
    const q = req.query;
    const p = parsePeriod(ctx, q.from, q.to);
    return kpiReport(ctx, { ...p, channel: q.channel || undefined, category: q.category || undefined, tier: q.tier || undefined, agentId: q.agent || undefined, includeDummy: q.includeDummy !== "false" });
  });

  // ---------------------------------------------------------------- reports (FR-39)
  app.get("/api/reports", { config: { auth: "staff", permission: "reports.read" } }, async () => ({
    items: (await ctx.db.generatedReport.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, periodFrom: true, periodTo: true, format: true, filename: true, includesDummy: true, createdAt: true } })).map((r) => ({ ...r, periodFrom: r.periodFrom.toISOString(), periodTo: r.periodTo.toISOString(), createdAt: r.createdAt.toISOString() })),
  }));
  app.post<{ Body: { from?: string; to?: string; format?: string; includeDummy?: boolean } }>("/api/reports", { config: { auth: "staff", permission: "reports.read" } }, async (req) => {
    const p = parsePeriod(ctx, req.body?.from, req.body?.to);
    const format = req.body?.format === "xlsx" ? "xlsx" : "pdf";
    const r = await generateReport(ctx, { ...p, format, includeDummy: req.body?.includeDummy !== false, userId: req.staff!.id, role: req.staff!.role });
    return { id: r.id, filename: r.filename };
  });
  app.get<{ Params: { id: string } }>("/api/reports/:id/download", { config: { auth: "staff", permission: "reports.read" } }, async (req, reply) => {
    const r = await ctx.db.generatedReport.findUnique({ where: { id: req.params.id } });
    if (!r) throw new HttpError(404, "not_found", "Laporan tidak ditemukan");
    return download(reply, Buffer.from(r.content), r.filename, TYPES[r.format as "pdf" | "xlsx"]);
  });

  // ---------------------------------------------------------------- exports (FR-32/62)
  app.get<{ Querystring: { from?: string; to?: string; format?: string; includeDummy?: string } }>("/api/exports/research", { config: { auth: "staff", permission: "research.export" } }, async (req, reply) => {
    const p = parsePeriod(ctx, req.query.from, req.query.to);
    const format = req.query.format === "xlsx" ? "xlsx" : "csv";
    // DUMMY data is excluded unless explicitly requested with includeDummy=true.
    const r = await researchExport(ctx, { ...p, format, includeDummy: req.query.includeDummy === "true", user: req.staff! });
    reply.header("x-rows", String(r.rows)).header("x-excluded-no-consent", String(r.excluded));
    return download(reply, r.body, `ekspor-penelitian-halokampus-${p.from.toISOString().slice(0, 10)}.${format}`, TYPES[format]);
  });
  app.get<{ Querystring: { format?: string; resourceType?: string; resourceId?: string } }>("/api/audit/export", { config: { auth: "staff", permission: "audit.read" } }, async (req, reply) => {
    const format = req.query.format === "json" ? "json" : "csv";
    const body = await auditExport(ctx, { format, resourceType: req.query.resourceType, resourceId: req.query.resourceId, user: req.staff! });
    return download(reply, body, `jejak-audit-halokampus.${format}`, TYPES[format]);
  });

  // ---------------------------------------------------------------- QA (FR-36)
  app.get<{ Querystring: { from?: string; to?: string } }>("/api/qa/sample", { config: { auth: "staff", permission: "qa.review" } }, async (req) => {
    const p = parsePeriod(ctx, req.query.from, req.query.to);
    const s = await qaSample(ctx, p.from, p.to);
    return { ...s, items: s.items.map((t) => ({ ...t, resolvedAt: t.resolvedAt?.toISOString() ?? null })), form: ctx.config.qaForm };
  });
  app.post<{ Body: { ticketId?: string; scores?: Record<string, number>; aiAnswerCorrect?: boolean | null; note?: string } }>("/api/qa/reviews", { config: { auth: "staff", permission: "qa.review" } }, async (req) => {
    const b = req.body ?? {};
    const r = await submitQaReview(ctx, req.staff!, { ticketId: String(b.ticketId ?? ""), scores: b.scores ?? {}, aiAnswerCorrect: typeof b.aiAnswerCorrect === "boolean" ? b.aiAnswerCorrect : null, note: b.note });
    return { id: r.id, score: Number(r.scorePercent) };
  });

  // ---------------------------------------------------------------- CP supervision (FR-34)
  app.get("/api/supervision/cp", { config: { auth: "staff", permission: "cp.supervise" } }, async () => ({ items: await cpOverview(ctx) }));
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/tickets/:id/release", { config: { auth: "staff", permission: "cp.supervise" } }, async (req) => {
    await releaseTicket(ctx, req.params.id, req.staff!, String(req.body?.reason ?? ""));
    return { ok: true };
  });
  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/tickets/:id/return-to-cp", { config: { auth: "staff", permission: "cp.supervise" } }, async (req) => {
    await returnToCp(ctx, req.params.id, req.staff!, String(req.body?.reason ?? ""));
    return { ok: true };
  });
  app.post<{ Body: { cpUserId?: string; ticketId?: string; text?: string } }>("/api/cp-feedback", { config: { auth: "staff", permission: "cp.supervise" } }, async (req) => {
    const r = await giveCpFeedback(ctx, req.staff!, { cpUserId: String(req.body?.cpUserId ?? ""), ticketId: req.body?.ticketId ?? null, text: String(req.body?.text ?? "") });
    return { id: r.id };
  });
  app.get("/api/me/feedback", { config: { auth: "staff", permission: "feedback.read_own" } }, async (req) => {
    const rows = await ctx.db.cpFeedback.findMany({ where: { cpUserId: req.staff!.id }, orderBy: { createdAt: "desc" }, take: 50 });
    await ctx.db.cpFeedback.updateMany({ where: { cpUserId: req.staff!.id, readAt: null }, data: { readAt: ctx.clock.now() } });
    const users = new Map((await ctx.db.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return { items: rows.map((r) => ({ id: r.id, from: users.get(r.staffUserId) ?? "Staf PMB", text: ctx.crypto.decrypt(r.textEnc), ticketId: r.ticketId, unread: !r.readAt, createdAt: r.createdAt.toISOString() })) };
  });

  // ---------------------------------------------------------------- orchestration (FR-35)
  app.get("/api/orchestration/current", { config: { auth: "staff", permission: "orchestration.read" } }, async (req) => {
    const { period, cycle } = await currentCycle(ctx, req.staff!.role === "staff");
    return { period: { ...period, start: period.start.toISOString(), end: period.end.toISOString() }, cycle: cycle ? { id: cycle.id, cadence: cycle.cadence, periodStart: cycle.periodStart.toISOString().slice(0, 10), checklist: cycle.checklist, closedAt: cycle.closedAt?.toISOString() ?? null } : null };
  });
  app.get("/api/orchestration", { config: { auth: "staff", permission: "orchestration.read" } }, async () => ({
    items: (await ctx.db.orchestrationCycle.findMany({ orderBy: { periodStart: "desc" }, take: 30 })).map((c) => {
      const items = ((c.checklist as { items?: Array<{ done: boolean }> }).items ?? []);
      return { id: c.id, cadence: c.cadence, periodStart: c.periodStart.toISOString().slice(0, 10), closedAt: c.closedAt?.toISOString() ?? null, done: items.filter((i) => i.done).length, total: items.length };
    }),
  }));
  app.post<{ Params: { id: string; itemId: string }; Body: { done?: boolean; note?: string } }>("/api/orchestration/:id/items/:itemId", { config: { auth: "staff", permission: "orchestration.manage" } }, async (req) => updateCycleItem(ctx, req.staff!, req.params.id, req.params.itemId, { done: Boolean(req.body?.done), note: req.body?.note }));
  app.post<{ Params: { id: string } }>("/api/orchestration/:id/close", { config: { auth: "staff", permission: "orchestration.manage" } }, async (req) => closeCycle(ctx, req.staff!, req.params.id));

  // ---------------------------------------------------------------- data-subject requests & retention (FR-65/66)
  app.get("/api/dsr", { config: { auth: "staff", permission: "dsr.manage" } }, async () => {
    const rows = await ctx.db.dataSubjectRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { customer: true } });
    return {
      items: rows.map((d) => ({
        id: d.id,
        type: d.type,
        typeLabel: DSR_TYPES[d.type as DsrType],
        status: d.status,
        customer: maskName(profileOf(ctx, d.customer).displayName) || "Calon mahasiswa",
        anonymized: Boolean(d.customer.anonymizedAt),
        detail: ctx.crypto.decryptOpt(d.detailEnc),
        dueAt: d.dueAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        closedAt: d.closedAt?.toISOString() ?? null,
      })),
    };
  });
  app.post<{ Params: { id: string }; Body: { status?: "in_progress" | "closed" | "rejected"; note?: string; execute?: boolean } }>("/api/dsr/:id", { config: { auth: "staff", permission: "dsr.manage" } }, async (req) => {
    await handleDsr(ctx, req.staff!, req.params.id, { status: req.body?.status as "closed", note: req.body?.note, execute: Boolean(req.body?.execute) });
    return { ok: true };
  });
  app.post("/api/retention/run", { config: { auth: "staff", permission: "dsr.manage" } }, async () => runRetention(ctx));

  // ---------------------------------------------------------------- usability surveys (FR-58)
  app.get("/api/usability", { config: { auth: "staff", permission: "usability.respond" } }, async (req) => {
    const surveys = usabilitySurveys(ctx, req.staff!.role);
    const answered = new Set((await ctx.db.surveyResponse.findMany({ where: { respondentUserId: req.staff!.id }, include: { survey: true } })).map((r) => r.survey.code));
    return { items: surveys.map((s) => ({ code: s.code, title: s.title, dummy: s.dummy, items: s.items, answered: answered.has(s.code) })) };
  });
  app.post<{ Params: { code: string }; Body: { answers?: Record<string, number> } }>("/api/usability/:code", { config: { auth: "staff", permission: "usability.respond" } }, async (req) => {
    await answerUsability(ctx, req.staff!, req.params.code, req.body?.answers ?? {});
    return { ok: true };
  });

  // ---------------------------------------------------------------- KB from PDF/DOCX (FR-33)
  app.post("/api/kb/upload", { config: { auth: "staff", permission: "kb.manage" } }, async (req) => {
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
    if (!part) throw new HttpError(400, "no_file", "Berkas tidak ditemukan");
    const field = (n: string) => String((part.fields[n] as { value?: string } | undefined)?.value ?? "").trim();
    const slug = field("slug");
    if (!/^[a-z0-9-]{2,60}$/.test(slug)) throw new HttpError(400, "invalid_slug", "Slug hanya huruf kecil, angka, dan tanda hubung");
    const buf = await part.toBuffer();
    const text = await fileToText(part.filename, part.mimetype, buf);
    if (text.trim().length < 20) throw new HttpError(400, "empty", "Teks tidak dapat diambil dari berkas (mungkin hasil pindai; perlu OCR)");
    const markdown = textToKbMarkdown(text, { title: field("title") || part.filename, effectiveFrom: field("effectiveFrom") || null, effectiveTo: field("effectiveTo") || null });
    return createKbDocument(ctx, { slug, markdown, userId: req.staff!.id });
  });
}
