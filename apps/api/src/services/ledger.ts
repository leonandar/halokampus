import type { Prisma, PrismaClient } from "@hk/db";
import type { EventType } from "@hk/shared";
import { sha256 } from "../crypto.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Canonical JSON (sorted keys) so hashes are reproducible by `audit:verify`. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

const GENESIS = "0".repeat(64);

export interface AuditEntry {
  at: Date;
  actorType: "user" | "ai" | "system" | "customer";
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Never put message bodies or personal data here. */
  detail?: Record<string, unknown>;
}

export function auditHashInput(prevHash: string, e: AuditEntry): string {
  return prevHash + canonical({
    at: e.at.toISOString(),
    actorType: e.actorType,
    actorId: e.actorId ?? null,
    actorRole: e.actorRole ?? null,
    action: e.action,
    resourceType: e.resourceType ?? null,
    resourceId: e.resourceId ?? null,
    detail: e.detail ?? {},
  });
}

/** Appends to audit_logs under an advisory lock so the hash chain stays linear (FR-32, NFR-08). */
export async function appendAudit(db: PrismaClient, e: AuditEntry, tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    await t.$executeRawUnsafe("SELECT pg_advisory_xact_lock(7001)");
    const last = await t.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const hash = sha256(auditHashInput(prevHash, e));
    await t.auditLog.create({
      data: {
        at: e.at,
        actorType: e.actorType,
        actorId: e.actorId ?? null,
        actorRole: e.actorRole ?? null,
        action: e.action,
        resourceType: e.resourceType ?? null,
        resourceId: e.resourceId ?? null,
        detail: (e.detail ?? {}) as Prisma.InputJsonValue,
        prevHash,
        hash,
      },
    });
  };
  if (tx) await run(tx);
  else await db.$transaction(run);
}

export interface EventEntry {
  occurredAt: Date;
  type: EventType;
  ticketId?: string | null;
  conversationId?: string | null;
  customerPseudoId?: string | null;
  channel?: string | null;
  tier?: string | null;
  category?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  payload?: Record<string, unknown>;
  policyVersions?: Record<string, number>;
  isDummy?: boolean;
}

export function eventHashInput(prevHash: string, e: EventEntry): string {
  return prevHash + canonical({
    occurredAt: e.occurredAt.toISOString(),
    type: e.type,
    ticketId: e.ticketId ?? null,
    conversationId: e.conversationId ?? null,
    customerPseudoId: e.customerPseudoId ?? null,
    channel: e.channel ?? null,
    tier: e.tier ?? null,
    category: e.category ?? null,
    actorType: e.actorType ?? null,
    actorId: e.actorId ?? null,
    payload: e.payload ?? {},
    policyVersions: e.policyVersions ?? {},
    isDummy: e.isDummy ?? false,
  });
}

/** Appends to `events`, the only source of KPI numbers (FR-59). */
export async function appendEvent(db: PrismaClient, e: EventEntry, tx?: Tx): Promise<void> {
  const run = async (t: Tx) => {
    await t.$executeRawUnsafe("SELECT pg_advisory_xact_lock(7002)");
    const last = await t.event.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? GENESIS;
    const hash = sha256(eventHashInput(prevHash, e));
    await t.event.create({
      data: {
        occurredAt: e.occurredAt,
        type: e.type,
        ticketId: e.ticketId ?? null,
        conversationId: e.conversationId ?? null,
        customerPseudoId: e.customerPseudoId ?? null,
        channel: e.channel ?? null,
        tier: e.tier ?? null,
        category: e.category ?? null,
        actorType: e.actorType ?? null,
        actorId: e.actorId ?? null,
        payload: (e.payload ?? {}) as Prisma.InputJsonValue,
        policyVersions: (e.policyVersions ?? {}) as Prisma.InputJsonValue,
        isDummy: e.isDummy ?? false,
        prevHash,
        hash,
      },
    });
  };
  if (tx) await run(tx);
  else await db.$transaction(run);
}

/** Recomputes both hash chains. Returns the first broken sequence number, if any. */
export async function verifyChains(db: PrismaClient): Promise<{ audit: { rows: number; brokenAt: bigint | null }; events: { rows: number; brokenAt: bigint | null } }> {
  let prev = GENESIS;
  let auditBroken: bigint | null = null;
  const audits = await db.auditLog.findMany({ orderBy: { seq: "asc" } });
  for (const a of audits) {
    const e: AuditEntry = { at: a.at, actorType: a.actorType as AuditEntry["actorType"], actorId: a.actorId, actorRole: a.actorRole, action: a.action, resourceType: a.resourceType, resourceId: a.resourceId, detail: a.detail as Record<string, unknown> };
    if (a.prevHash !== prev || sha256(auditHashInput(prev, e)) !== a.hash) { auditBroken = a.seq; break; }
    prev = a.hash;
  }
  prev = GENESIS;
  let eventBroken: bigint | null = null;
  const events = await db.event.findMany({ orderBy: { seq: "asc" } });
  for (const ev of events) {
    const e: EventEntry = { occurredAt: ev.occurredAt, type: ev.type as EventType, ticketId: ev.ticketId, conversationId: ev.conversationId, customerPseudoId: ev.customerPseudoId, channel: ev.channel, tier: ev.tier, category: ev.category, actorType: ev.actorType, actorId: ev.actorId, payload: ev.payload as Record<string, unknown>, policyVersions: ev.policyVersions as Record<string, number>, isDummy: ev.isDummy };
    if (ev.prevHash !== prev || sha256(eventHashInput(prev, e)) !== ev.hash) { eventBroken = ev.seq; break; }
    prev = ev.hash;
  }
  return { audit: { rows: audits.length, brokenAt: auditBroken }, events: { rows: events.length, brokenAt: eventBroken } };
}
