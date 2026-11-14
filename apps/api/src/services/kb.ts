import { answerAgent, parseKbMarkdown, type CustomerProfile, type RetrievedChunk } from "@hk/ai";
import type { Ctx } from "../context.js";
import { appendAudit, appendEvent } from "./ledger.js";

const toVector = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

export class KbError extends Error {
  readonly status: number;
  constructor(public code: string, message: string) {
    super(message);
    this.status = code === "not_found" ? 404 : code === "not_tested" ? 409 : 400;
  }
}

/** Creates a draft document version and embeds its sections (FR-33). */
export async function createKbDocument(
  ctx: Ctx,
  args: { slug: string; markdown: string; userId?: string | null; isDummy?: boolean },
): Promise<{ id: string; version: number; chunks: number }> {
  const parsed = parseKbMarkdown(args.markdown);
  if (parsed.sections.length === 0) throw new KbError("empty", "Dokumen tidak memiliki isi");
  const latest = await ctx.db.kbDocument.findFirst({ where: { slug: args.slug }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const vectors = await ctx.embedder.embed(parsed.sections.map((s) => `${s.heading}\n${s.content}`));
  const now = ctx.clock.now();
  const doc = await ctx.db.kbDocument.create({
    data: {
      slug: args.slug,
      title: parsed.title,
      version,
      status: "draft",
      effectiveFrom: parsed.effectiveFrom ? new Date(parsed.effectiveFrom) : null,
      effectiveTo: parsed.effectiveTo ? new Date(parsed.effectiveTo) : null,
      scope: parsed.scope,
      sourceText: args.markdown,
      embeddingModel: ctx.embedder.model,
      createdBy: args.userId ?? null,
      isDummy: args.isDummy ?? /\[DUMMY\]/.test(parsed.title),
      createdAt: now,
    },
  });
  for (const [i, s] of parsed.sections.entries()) {
    await ctx.db.$executeRawUnsafe(
      `INSERT INTO kb_chunks (id, document_id, ord, section, scope, content, embedding) VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4::jsonb, $5, $6::vector)`,
      doc.id,
      i,
      s.heading,
      JSON.stringify({ ...parsed.scope, ...s.scope }),
      s.content,
      toVector(vectors[i]!),
    );
  }
  if (args.userId) {
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.userId, actorRole: "staff", action: "kb.create", resourceType: "kb_document", resourceId: doc.id, detail: { slug: args.slug, version } });
  }
  return { id: doc.id, version, chunks: parsed.sections.length };
}

interface ChunkRow {
  id: string;
  document_id: string;
  title: string;
  version: number;
  section: string;
  content: string;
  scope: Record<string, string>;
  sim: number;
  rank: number;
}

const SCOPE_KEYS: Array<[keyof CustomerProfile, string]> = [
  ["programCode", "program"],
  ["admissionPath", "path"],
  ["stage", "stage"],
];

/**
 * Hybrid retrieval (pgvector cosine + full-text) with reciprocal-rank fusion, filtered
 * by effective date and the customer's program/path/stage (Filtering, FR-12/13).
 * `similarity` of each chunk is the cosine similarity — that is S_ret.
 */
export async function retrieve(
  ctx: Ctx,
  query: string,
  opts: { profile?: CustomerProfile; k?: number; documentIds?: string[] } = {},
): Promise<RetrievedChunk[]> {
  const [vec] = await ctx.embedder.embed([query]);
  const today = ctx.clock.now().toISOString().slice(0, 10);
  const byDoc = opts.documentIds?.length;
  const rows = await ctx.db.$queryRawUnsafe<ChunkRow[]>(
    `SELECT c.id, c.document_id, d.title, d.version, c.section, c.content, c.scope,
            (1 - (c.embedding <=> $1::vector))::float8 AS sim,
            ts_rank(c.tsv, plainto_tsquery('simple', $2))::float8 AS rank
       FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
      WHERE d.embedding_model = $3
        AND ${byDoc ? `d.id = ANY($5::uuid[]) AND $4::date IS NOT NULL` : `d.status = 'published'
        AND (d.effective_from IS NULL OR d.effective_from <= $4::date)
        AND (d.effective_to IS NULL OR d.effective_to >= $4::date)`}
      ORDER BY sim DESC
      LIMIT 30`,
    toVector(vec!),
    query,
    ctx.embedder.model,
    today,
    ...(byDoc ? [opts.documentIds] : []),
  );
  const profile = opts.profile ?? {};
  const allowed = rows.filter((r) =>
    SCOPE_KEYS.every(([pk, sk]) => {
      const want = profile[pk];
      const has = r.scope?.[sk];
      return !has || !want || has === want;
    }),
  );
  const bySim = [...allowed].sort((a, b) => b.sim - a.sim);
  const byText = [...allowed].sort((a, b) => b.rank - a.rank);
  const rrf = new Map<string, number>();
  bySim.forEach((r, i) => rrf.set(r.id, (rrf.get(r.id) ?? 0) + 1 / (60 + i)));
  byText.forEach((r, i) => r.rank > 0 && rrf.set(r.id, (rrf.get(r.id) ?? 0) + 1 / (60 + i)));
  return allowed
    .sort((a, b) => (rrf.get(b.id) ?? 0) - (rrf.get(a.id) ?? 0))
    .slice(0, opts.k ?? 4)
    .map((r) => ({ id: r.id, documentId: r.document_id, title: r.title, version: r.version, section: r.section, content: r.content, similarity: Math.max(0, r.sim) }));
}

/** Pre-publication Q&A test (FR-33): every question is answered against this document only. */
export async function testKbDocument(ctx: Ctx, args: { documentId: string; questions: string[]; userId: string }) {
  const doc = await ctx.db.kbDocument.findUnique({ where: { id: args.documentId } });
  if (!doc) throw new KbError("not_found", "Dokumen tidak ditemukan");
  if (args.questions.length === 0) throw new KbError("no_questions", "Minimal satu pertanyaan uji");
  const results = [];
  for (const q of args.questions) {
    const chunks = await retrieve(ctx, q, { documentIds: [doc.id], k: 3 });
    let answer = "";
    try {
      answer = (await answerAgent(ctx.llm, { question: q, chunks, profile: {} })).answer;
    } catch (e) {
      answer = `[gagal: ${(e as Error).message}]`;
    }
    results.push({ question: q, topSection: chunks[0]?.section ?? null, similarity: chunks[0]?.similarity ?? 0, answer });
  }
  const now = ctx.clock.now();
  const report = { results, ranAt: now.toISOString(), provider: ctx.llm.chainFor("answer").map((p) => p.id) };
  await ctx.db.kbDocument.update({ where: { id: doc.id }, data: { status: doc.status === "published" ? "published" : "tested", testReport: report, testedAt: now, testedBy: args.userId } });
  await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.userId, actorRole: "staff", action: "kb.test", resourceType: "kb_document", resourceId: doc.id, detail: { questions: args.questions.length } });
  return report;
}

/** Publishes a tested version and retires the previous one (FR-33). */
export async function publishKbDocument(ctx: Ctx, args: { documentId: string; userId: string; actorRole?: string }) {
  const doc = await ctx.db.kbDocument.findUnique({ where: { id: args.documentId } });
  if (!doc) throw new KbError("not_found", "Dokumen tidak ditemukan");
  if (doc.status !== "tested") throw new KbError("not_tested", "Dokumen harus lulus uji tanya-jawab sebelum terbit");
  const now = ctx.clock.now();
  await ctx.db.$transaction(async (tx) => {
    await tx.kbDocument.updateMany({ where: { slug: doc.slug, status: "published" }, data: { status: "retired" } });
    await tx.kbDocument.update({ where: { id: doc.id }, data: { status: "published", publishedAt: now, publishedBy: args.userId } });
    await appendAudit(ctx.db, { at: now, actorType: "user", actorId: args.userId, actorRole: args.actorRole ?? "staff", action: "kb.publish", resourceType: "kb_document", resourceId: doc.id, detail: { slug: doc.slug, version: doc.version } }, tx);
    await appendEvent(ctx.db, { occurredAt: now, type: "kb_published", actorType: "staff", actorId: args.userId, payload: { slug: doc.slug, version: doc.version }, isDummy: doc.isDummy }, tx);
  });
}
