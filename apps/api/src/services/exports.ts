import { createHmac } from "node:crypto";
import ExcelJS from "exceljs";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";

/**
 * Anonymised research export (FR-62). Rules:
 *  - stable pseudonyms: HMAC-SHA256 with RESEARCH_PSEUDONYM_KEY (never the internal ids);
 *  - no names, phone numbers, emails, registration numbers or message text: only
 *    whitelisted payload keys with numeric/enumerated values are exported;
 *  - DUMMY data excluded unless explicitly requested;
 *  - customers are included only if they granted the "service_improvement" purpose (docs/PDP.md).
 */
const PAYLOAD_WHITELIST = new Set([
  "from", "to", "reason", "mandatory", "confidence", "latencyMs", "provider", "helpful", "streak", "type", "cause", "survey", "answers", "scale",
  "dummyItems", "status", "purpose", "paramCode", "kind", "elapsedMs", "waitMs", "draftUsage", "resolutionMs", "minutes", "waiting", "by",
  "reopenCount", "daysWindow", "surveys", "action", "ok", "score", "aiAnswerCorrect", "formVersion", "durationMs", "enabled", "code", "version",
  "length", "detectedBy", "respondent", "via",
]);

export function pseudonym(key: string, kind: string, id: string | null | undefined): string {
  if (!id) return "";
  return createHmac("sha256", key).update(`${kind}:${id}`).digest("hex").slice(0, 16);
}

function sanitizePayload(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (!PAYLOAD_WHITELIST.has(k)) continue;
    if (typeof v === "string" && v.length > 60) continue; // never free text
    out[k] = v;
  }
  return out;
}

const COLUMNS = ["occurred_at", "type", "ticket", "customer", "channel", "tier", "category", "actor_role", "actor", "payload"] as const;

export async function researchRows(ctx: Ctx, q: { from: Date; to: Date; includeDummy: boolean }) {
  const key = ctx.env.RESEARCH_PSEUDONYM_KEY;
  if (!key) throw Object.assign(new Error("RESEARCH_PSEUDONYM_KEY belum diatur"), { status: 500, code: "no_key" });
  const events = await ctx.db.event.findMany({ where: { occurredAt: { gte: q.from, lt: q.to }, ...(q.includeDummy ? {} : { isDummy: false }) }, orderBy: { seq: "asc" } });
  // Consent filter: map events → customer, keep only customers with service_improvement granted.
  const ticketIds = [...new Set(events.map((e) => e.ticketId).filter((x): x is string => Boolean(x)))];
  const tickets = await ctx.db.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, customerId: true } });
  const customers = await ctx.db.customer.findMany({ select: { id: true, pseudoId: true } });
  const byPseudo = new Map(customers.map((c) => [c.pseudoId, c.id]));
  const ticketCustomer = new Map(tickets.map((t) => [t.id, t.customerId]));
  const latest = new Map<string, boolean>();
  for (const c of await ctx.db.consent.findMany({ where: { purpose: "service_improvement" }, orderBy: { grantedAt: "asc" } })) latest.set(c.customerId, c.status === "granted");
  const consented = new Set([...latest].filter(([, ok]) => ok).map(([id]) => id));
  const staff = new Set((await ctx.db.user.findMany({ select: { id: true } })).map((u) => u.id));
  let excluded = 0;
  const rows = [];
  for (const e of events) {
    const customerId = (e.ticketId && ticketCustomer.get(e.ticketId)) || (e.customerPseudoId && byPseudo.get(e.customerPseudoId)) || null;
    if (customerId && !consented.has(customerId)) {
      excluded++;
      continue;
    }
    rows.push({
      occurred_at: e.occurredAt.toISOString(),
      type: e.type,
      ticket: pseudonym(key, "ticket", e.ticketId),
      customer: pseudonym(key, "customer", customerId),
      channel: e.channel ?? "",
      tier: e.tier ?? "",
      category: e.category ?? "",
      actor_role: e.actorType ?? "",
      actor: e.actorId && staff.has(e.actorId) ? pseudonym(key, "staff", e.actorId) : "",
      payload: JSON.stringify(sanitizePayload(e.payload as Record<string, unknown>)),
    });
  }
  return { rows, excluded, total: events.length };
}

export function toCsv(columns: readonly string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

export async function researchExport(ctx: Ctx, q: { from: Date; to: Date; includeDummy: boolean; format: "csv" | "xlsx"; user: { id: string; role: string } }) {
  const { rows, excluded, total } = await researchRows(ctx, q);
  let body: Buffer;
  if (q.format === "csv") body = Buffer.from(toCsv(COLUMNS, rows), "utf8");
  else {
    const wb = new ExcelJS.Workbook();
    wb.creator = "haloK@MPUS";
    const ws = wb.addWorksheet("events");
    ws.columns = COLUMNS.map((c) => ({ header: c, key: c, width: c === "payload" ? 60 : 18 }));
    ws.addRows(rows);
    const info = wb.addWorksheet("keterangan");
    info.addRows([
      ["Sumber", "haloK@MPUS — tabel events (teranonimkan)"],
      ["Periode", `${q.from.toISOString()} – ${q.to.toISOString()}`],
      ["Data DUMMY", q.includeDummy ? "TERMASUK (atas permintaan eksplisit)" : "dikecualikan"],
      ["Pseudonim", "HMAC-SHA256 dengan kunci penelitian; stabil antarekspor"],
      ["Baris dikecualikan (tanpa persetujuan perbaikan layanan)", excluded],
    ]);
    body = Buffer.from(await wb.xlsx.writeBuffer());
  }
  const now = ctx.clock.now();
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: q.user.id, actorRole: q.user.role, action: "research.export", detail: { from: q.from.toISOString(), to: q.to.toISOString(), format: q.format, includeDummy: q.includeDummy, rows: rows.length, excludedNoConsent: excluded } });
  await appendEvent(ctx.db, { occurredAt: now, type: "export_generated", actorType: q.user.role, actorId: q.user.id, payload: { kind: "research", format: q.format, rows: rows.length } });
  return { body, rows: rows.length, excluded, total };
}

/** Audit trail export (FR-32): every column including the hash chain, so it can be verified offline. */
export async function auditExport(ctx: Ctx, q: { format: "csv" | "json"; resourceType?: string; resourceId?: string; user: { id: string; role: string } }) {
  const where: Record<string, string> = {};
  if (q.resourceType) where.resourceType = q.resourceType;
  if (q.resourceId) where.resourceId = q.resourceId;
  const rows = (await ctx.db.auditLog.findMany({ where, orderBy: { seq: "asc" } })).map((a) => ({
    seq: a.seq.toString(),
    at: a.at.toISOString(),
    actor_type: a.actorType,
    actor_id: a.actorId ?? "",
    actor_role: a.actorRole ?? "",
    action: a.action,
    resource_type: a.resourceType ?? "",
    resource_id: a.resourceId ?? "",
    detail: JSON.stringify(a.detail),
    prev_hash: a.prevHash,
    hash: a.hash,
  }));
  await appendAudit(ctx.db, { at: ctx.clock.now(), actorType: "user", actorId: q.user.id, actorRole: q.user.role, action: "audit.export", detail: { format: q.format, rows: rows.length, resourceType: q.resourceType ?? null } });
  if (q.format === "json") return Buffer.from(JSON.stringify(rows, null, 2), "utf8");
  return Buffer.from(toCsv(Object.keys(rows[0] ?? { seq: "" }), rows), "utf8");
}
