import { z } from "zod";
import { Prisma, type PrismaClient } from "@hk/db";
import { BusinessCalendar, type Clock } from "@hk/domain";
import type { ConfidenceWeights, ParamCode, Role, SlaDuration, WeeklyHours } from "@hk/shared";
import { appendAudit, appendEvent } from "./ledger.js";

const sla = z.object({ unit: z.enum(["seconds", "service_seconds", "business_days"]), value: z.number().positive() });
const hours = z.object({
  timezone: z.string().min(1),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  days: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)]))),
});
const unit01 = z.number().min(0).max(1);
const nullablePositive = z.number().positive().nullable();

/** Validation of every parameter value. Unknown codes are rejected. */
export const PARAM_SCHEMAS: Record<ParamCode, z.ZodTypeAny> = {
  "PRM-01": unit01,
  "PRM-02": sla,
  "PRM-03": sla,
  "PRM-04": sla,
  "PRM-05": sla,
  "PRM-06": z.object({ normal: z.enum(["weekly", "daily"]), peak: z.enum(["weekly", "daily"]) }),
  "PRM-07": hours,
  "PRM-08": nullablePositive,
  "PRM-09": z.object({ retrieval: z.number().min(0), intent: z.number().min(0), self: z.number().min(0) }).refine((w) => w.retrieval + w.intent + w.self > 0),
  "PRM-10": unit01,
  "PRM-11": nullablePositive,
  "PRM-12": nullablePositive,
  "PRM-13": sla.nullable(),
  "PRM-14": z.record(z.string(), z.number()),
  "PRM-15": z.object({ surveys: z.array(z.string().regex(/^[a-z0-9_-]+$/)) }).nullable(),
  "PRM-16": z.object({ samplePercent: z.number().min(0).max(100) }).nullable(),
  "PRM-17": z.object({ ttlSeconds: z.number().int().positive(), maxAttempts: z.number().int().positive() }),
  "PRM-18": z.array(z.object({ from: z.string(), to: z.string() })).nullable(),
  "PRM-19": hours.nullable(),
  "PRM-20": z.record(z.string(), z.array(z.string())),
};

/** Prisma needs JsonNull for a JSON `null` value. */
export function jsonValue(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return v === null || v === undefined ? Prisma.JsonNull : (v as Prisma.InputJsonValue);
}

export class ParamError extends Error {
  readonly status: number;
  constructor(public code: string, message: string) {
    super(message);
    this.status = code === "not_found" ? 404 : code === "forbidden" ? 403 : 400;
  }
}

interface Active {
  value: unknown;
  version: number;
}

/**
 * Versioned policy parameters (FR-37). Reads are cached for a few seconds; every change
 * needs two different people, one `leader` and one `staff` (decision Q5).
 */
export class ParamService {
  private cache: { at: number; values: Map<string, Active> } | null = null;
  constructor(private readonly db: PrismaClient, private readonly clock: Clock, private readonly ttlMs = 2000) {}

  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<Map<string, Active>> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.values;
    const rows = await this.db.policyParameter.findMany({ where: { status: "active" } });
    const values = new Map(rows.map((r) => [r.code, { value: r.value, version: r.version }]));
    this.cache = { at: now, values };
    return values;
  }

  async get<T>(code: ParamCode): Promise<T> {
    const v = (await this.load()).get(code);
    if (!v) throw new ParamError("missing", `Parameter ${code} has no active version`);
    return v.value as T;
  }

  async versions(codes: ParamCode[]): Promise<Record<string, number>> {
    const m = await this.load();
    return Object.fromEntries(codes.map((c) => [c, m.get(c)?.version ?? 0]));
  }

  // Typed helpers used by the pipeline
  confidenceThreshold = () => this.get<number>("PRM-01");
  weights = () => this.get<ConfidenceWeights>("PRM-09");
  minRetrieval = () => this.get<number>("PRM-10");
  sla = (code: "PRM-02" | "PRM-03" | "PRM-04" | "PRM-05") => this.get<SlaDuration>(code);

  async workCalendar(): Promise<BusinessCalendar> {
    return new BusinessCalendar(await this.get<WeeklyHours>("PRM-07"));
  }
  /** CP service hours (PRM-19); falls back to PRM-07 while not set. */
  async serviceCalendar(): Promise<BusinessCalendar> {
    const own = await this.get<WeeklyHours | null>("PRM-19");
    return own ? new BusinessCalendar(own) : this.workCalendar();
  }

  async list() {
    return this.db.policyParameter.findMany({ orderBy: [{ code: "asc" }, { version: "desc" }] });
  }

  async propose(args: { code: string; value: unknown; reason: string; userId: string; role: Role }) {
    if (!(args.code in PARAM_SCHEMAS)) throw new ParamError("unknown_code", `Kode parameter tidak dikenal: ${args.code}`);
    if (args.role !== "staff" && args.role !== "leader") throw new ParamError("forbidden", "Hanya Staf PMB atau Pimpinan yang dapat mengusulkan");
    if (!args.reason?.trim()) throw new ParamError("reason_required", "Alasan perubahan wajib diisi");
    const parsed = PARAM_SCHEMAS[args.code as ParamCode].safeParse(args.value);
    if (!parsed.success) throw new ParamError("invalid_value", `Nilai tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const now = this.clock.now();
    return this.db.$transaction(async (tx) => {
      const latest = await tx.policyParameter.findFirst({ where: { code: args.code }, orderBy: { version: "desc" } });
      const row = await tx.policyParameter.create({
        data: {
          code: args.code,
          version: (latest?.version ?? 0) + 1,
          value: jsonValue(parsed.data),
          status: "proposed",
          source: "perubahan",
          label: latest?.label ?? args.code,
          reason: args.reason,
          proposedBy: args.userId,
          proposedRole: args.role,
          createdAt: now,
        },
      });
      await appendAudit(this.db, { at: now, actorType: "user", actorId: args.userId, actorRole: args.role, action: "parameter.propose", resourceType: "policy_parameter", resourceId: row.id, detail: { code: args.code, version: row.version } }, tx);
      await appendEvent(this.db, { occurredAt: now, type: "parameter_proposed", actorType: args.role, actorId: args.userId, payload: { code: args.code, version: row.version } }, tx);
      return row;
    });
  }

  /** Second person approves. Proposer ≠ approver and the two roles must be {leader, staff}. */
  async approve(args: { id: string; userId: string; role: Role }) {
    const now = this.clock.now();
    return this.db.$transaction(async (tx) => {
      const p = await tx.policyParameter.findUnique({ where: { id: args.id } });
      if (!p || p.status !== "proposed") throw new ParamError("not_found", "Usulan tidak ditemukan atau sudah diproses");
      if (p.proposedBy === args.userId) throw new ParamError("same_person", "Pengusul tidak boleh menyetujui usulannya sendiri");
      const pair = new Set([p.proposedRole, args.role]);
      if (!(pair.has("leader") && pair.has("staff"))) throw new ParamError("role_pair", "Perubahan parameter membutuhkan satu Pimpinan dan satu Staf PMB");
      await tx.policyParameter.updateMany({ where: { code: p.code, status: "active" }, data: { status: "superseded" } });
      const row = await tx.policyParameter.update({
        where: { id: p.id },
        data: { status: "active", approvedBy: args.userId, approvedRole: args.role, effectiveFrom: now },
      });
      await appendAudit(this.db, { at: now, actorType: "user", actorId: args.userId, actorRole: args.role, action: "parameter.approve", resourceType: "policy_parameter", resourceId: p.id, detail: { code: p.code, version: p.version, proposedBy: p.proposedBy } }, tx);
      await appendEvent(this.db, { occurredAt: now, type: "parameter_changed", actorType: args.role, actorId: args.userId, payload: { code: p.code, version: p.version } }, tx);
      this.invalidate();
      return row;
    });
  }

  /** Seeds version 1 of every parameter from config/parameters.default.yaml if absent. */
  async seedDefaults(defaults: Record<string, { value: unknown; source: string; label: string }>): Promise<number> {
    let n = 0;
    for (const [code, d] of Object.entries(defaults)) {
      const exists = await this.db.policyParameter.findFirst({ where: { code } });
      if (exists) continue;
      const schema = PARAM_SCHEMAS[code as ParamCode];
      if (!schema) throw new Error(`Unknown parameter in defaults: ${code}`);
      const parsed = schema.parse(d.value);
      await this.db.policyParameter.create({
        data: { code, version: 1, value: jsonValue(parsed), status: "active", source: d.source, label: d.label, effectiveFrom: this.clock.now() },
      });
      n++;
    }
    this.invalidate();
    return n;
  }
}
