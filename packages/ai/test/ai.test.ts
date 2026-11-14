import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import {
  IntentClassifier,
  LlmRouter,
  MockEmbedding,
  MockProvider,
  answerAgent,
  containsPii,
  cosine,
  parseKbMarkdown,
  redact,
  restore,
  runGuard,
  validateFile,
  type GuardConfig,
  type IntentConfig,
  type LLMProvider,
  type RetrievedChunk,
} from "../src/index.js";

const CONFIG = join(import.meta.dirname, "../../../config");
const load = (f: string) => yaml.load(readFileSync(join(CONFIG, f), "utf8")) as any;

function intentConfig(): IntentConfig {
  const raw = load("intents.yaml");
  return {
    temperature: raw.temperature,
    minSimilarity: raw.min_similarity,
    humanRequestPatterns: raw.human_request_patterns,
    emotionPatterns: raw.emotion_patterns,
    intents: raw.intents,
  };
}

function guardConfig(): GuardConfig {
  const raw = load("ai-authority.yaml");
  return {
    rules: raw.rules.map((r: any) => ({ actionKey: r.action, authorityClass: r.class })),
    forbiddenOutputPatterns: raw.forbidden_output_patterns,
    forbiddenDataRequestPatterns: raw.forbidden_data_request_patterns,
  };
}

describe("intent classifier (FR-01) with DUMMY examples", () => {
  const clf = new IntentClassifier(intentConfig(), new MockEmbedding());
  beforeAll(() => clf.init());

  it.each([
    ["Pembayaran saya gagal tapi saldo sudah terpotong", "pembayaran"],
    ["saya sudah transfer kemarin tapi status belum lunas", "pembayaran"],
    ["Nama saya salah ketik, mohon diubah", "perubahan_data"],
    ["Apakah bisa minta dispensasi tenggat unggah berkas?", "pengecualian"],
    ["Saya penyandang disabilitas, ada jalur khusus?", "jalur_khusus"],
    ["SAYA SANGAT KECEWA DENGAN PELAYANAN INI", "keluhan_berat"],
  ])("mandatory: %s → %s (rule layer)", async (text, cat) => {
    const r = await clf.classify(text);
    expect(r.category).toBe(cat);
    expect(r.method).toBe("rule");
    expect(r.probability).toBe(1);
  });

  it.each([
    ["Kapan batas akhir pendaftaran jalur mandiri?", "jadwal"],
    ["Berapa biaya pendaftaran?", "biaya"],
    ["Berkas apa saja yang harus diunggah?", "persyaratan"],
  ])("informational: %s → %s (examples layer)", async (text, cat) => {
    const r = await clf.classify(text);
    expect(r.category).toBe(cat);
    expect(r.method).toBe("examples");
    expect(r.probability).toBeGreaterThan(0);
    expect(r.probability).toBeLessThanOrEqual(1);
  });

  it("does not treat a fee question as a payment problem", async () => {
    expect((await clf.classify("berapa biaya pendaftaran jalur mandiri")).category).toBe("biaya");
  });

  it("detects a request for a human", async () => {
    expect((await clf.classify("saya mau bicara dengan manusia saja")).requestHuman).toBe(true);
    expect((await clf.classify("kapan pengumuman?")).requestHuman).toBe(false);
  });
});

describe("PII redaction (FR-68)", () => {
  it("redacts and restores phone, email, NIK, registration no. and name", () => {
    const text = "Saya Budi Santoso, HP 081234567890, email budi@example.com, NIK 3401010101010001, no PMB-2027-000123";
    const r = redact(text, [{ kind: "NAME", value: "Budi Santoso" }]);
    expect(r.text).not.toMatch(/Budi|0812|budi@|3401010101010001|PMB-2027/);
    expect(containsPii(r.text)).toBe(false);
    expect(restore(r.text, r.map)).toBe(text);
  });
});

describe("policy guard (FR-15)", () => {
  const cfg = guardConfig();
  it("passes a cited, compliant answer", () => {
    expect(runGuard({ actionKey: "kb.answer", outputText: "Biaya pendaftaran Rp250.000.", citationCount: 1 }, cfg).passed).toBe(true);
  });
  it("blocks answers without citation", () => {
    expect(runGuard({ actionKey: "kb.answer", outputText: "Biaya Rp250.000.", citationCount: 0 }, cfg).passed).toBe(false);
  });
  it("KB-12: blocks forbidden actions and promises even if the LLM produced them", () => {
    expect(runGuard({ actionKey: "pmb.update_applicant" }, cfg).passed).toBe(false);
    const r = runGuard({ actionKey: "kb.answer", outputText: "Tenang, data Kakak sudah saya ubah dan Kakak pasti lulus.", citationCount: 1 }, cfg);
    expect(r.passed).toBe(false);
    expect(r.violations.join(" ")).toMatch(/kelulusan|mengubah data/);
  });
  it("blocks requests for data outside the allowed list", () => {
    expect(runGuard({ actionKey: "kb.answer", outputText: "Silakan kirimkan NIK dan nama ibu kandung Kakak.", citationCount: 1 }, cfg).passed).toBe(false);
  });
});

describe("file validation (FR-14)", () => {
  const rule = { docType: "pas_foto", label: "Pas foto", extensions: ["jpg", "png"], mimeTypes: ["image/jpeg", "image/png"], maxBytes: 524288 };
  it("accepts a valid photo", () => expect(validateFile({ name: "foto.jpg", size: 100_000, mime: "image/jpeg" }, rule).ok).toBe(true));
  it("rejects wrong type and oversize", () => {
    const r = validateFile({ name: "foto.pdf", size: 900_000, mime: "application/pdf" }, rule);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(3);
  });
});

describe("KB parsing", () => {
  it("parses DUMMY documents into scoped sections", () => {
    const files = readdirSync(join(CONFIG, "kb-dummy"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    const doc = parseKbMarkdown(readFileSync(join(CONFIG, "kb-dummy/04-jalur.md"), "utf8"));
    expect(doc.title).toContain("[DUMMY]");
    expect(doc.effectiveFrom).toBe("2026-01-01");
    const ti = doc.sections.find((s) => s.heading.startsWith("Program studi Teknik Informatika"));
    expect(ti?.scope).toEqual({ program: "S1-TI" });
  });
});

describe("LLM router & answer agent (FR-19)", () => {
  const chunk: RetrievedChunk = {
    id: "c1",
    documentId: "d1",
    title: "Biaya",
    version: 1,
    section: "Biaya pendaftaran",
    content: "Biaya pendaftaran jalur mandiri sebesar Rp250.000. Dibayar via virtual account.",
    similarity: 0.8,
  };

  it("mock answer is extractive and cites the chunk", async () => {
    const router = new LlmRouter({ mock: new MockProvider() }, {}, ["mock"]);
    const out = await answerAgent(router, { question: "berapa biaya?", chunks: [chunk], profile: {} });
    expect(out.answer).toContain("Rp250.000");
    expect(out.usedChunkIds).toEqual(["c1"]);
    expect(out.selfConfidence).toBeCloseTo(0.9);
    expect(out.llm.provider).toBe("mock");
  });

  it("falls back to the next provider when the first fails, and redacts PII before sending", async () => {
    const seen: string[] = [];
    const broken: LLMProvider = { id: "broken", model: "x", location: "external", complete: async (r) => { seen.push(r.user); throw new Error("down"); } };
    const router = new LlmRouter({ broken, mock: new MockProvider() }, { answer: ["broken", "mock"] }, ["mock"]);
    const out = await answerAgent(router, {
      question: "Saya Siti, nomor saya 081298765432, berapa biayanya?",
      chunks: [chunk],
      profile: { displayName: "Siti" },
    });
    expect(out.llm.provider).toBe("mock");
    expect(seen[0]).not.toContain("081298765432");
    expect(seen[0]).not.toContain("Siti");
    expect(out.sentPrompt).toContain("⟦PHONE_1⟧");
  });

  it("throws when every provider fails (caller then routes to a human)", async () => {
    const broken: LLMProvider = { id: "broken", model: "x", location: "local", complete: async () => { throw new Error("down"); } };
    const router = new LlmRouter({ broken }, {}, ["broken"]);
    await expect(answerAgent(router, { question: "x", chunks: [chunk], profile: {} })).rejects.toThrow(/All LLM providers failed/);
  });

  it("mock embedding similarity reflects lexical overlap", async () => {
    const e = new MockEmbedding();
    const [a, b, c] = await e.embed(["biaya pendaftaran jalur mandiri", "berapa biaya pendaftaran mandiri", "jadwal tes seleksi"]);
    expect(cosine(a!, b!)).toBeGreaterThan(cosine(a!, c!));
  });
});
