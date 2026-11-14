import { CATEGORIES, isMandatoryCategory, type Category } from "@hk/shared";
import { cosine, type EmbeddingProvider } from "./embedding.js";

export interface IntentConfig {
  humanRequestPatterns: string[];
  emotionPatterns: string[];
  intents: Array<{ category: Category; rules?: string[]; examples: string[] }>;
  /** Softmax temperature over per-intent similarities. */
  temperature: number;
  /** Below this best similarity the message is classified as `lainnya`. */
  minSimilarity: number;
}

export interface IntentResult {
  category: Category;
  probability: number;
  method: "rule" | "examples" | "none";
  rulesHit: string[];
  requestHuman: boolean;
  emotionHigh: boolean;
  /** Per-category best similarity, for explainability (FR-18). */
  scores: Record<string, number>;
}

const compile = (p: string) => new RegExp(p, "i");

/**
 * Two-layer intent classifier (FR-01, ADR-06):
 *  1. configurable keyword rules, high recall for the five mandatory categories;
 *  2. nearest-example classifier over labelled examples, whose softmax probability is
 *     the P_int component of the confidence score.
 */
export class IntentClassifier {
  private exampleVectors: Array<{ category: Category; vector: number[] }> = [];
  private readonly human: RegExp[];
  private readonly emotion: RegExp[];
  private readonly rules: Array<{ category: Category; re: RegExp; src: string }>;

  constructor(private readonly config: IntentConfig, private readonly embedder: EmbeddingProvider) {
    this.human = config.humanRequestPatterns.map(compile);
    this.emotion = config.emotionPatterns.map(compile);
    this.rules = config.intents.flatMap((i) => (i.rules ?? []).map((src) => ({ category: i.category, re: compile(src), src })));
    for (const i of config.intents) if (!(i.category in CATEGORIES)) throw new Error(`Unknown category in intents config: ${i.category}`);
  }

  async init(): Promise<void> {
    const flat = this.config.intents.flatMap((i) => i.examples.map((e) => ({ category: i.category, text: e })));
    const vectors = await this.embedder.embed(flat.map((f) => f.text));
    this.exampleVectors = flat.map((f, idx) => ({ category: f.category, vector: vectors[idx]! }));
  }

  async classify(text: string, opts: { rulesOnly?: boolean } = {}): Promise<IntentResult> {
    const requestHuman = this.human.some((r) => r.test(text));
    const emotionHigh = this.emotion.some((r) => r.test(text)) || shoutingRatio(text) > 0.6;
    const hits = this.rules.filter((r) => r.re.test(text));
    const mandatoryHit = hits.find((h) => isMandatoryCategory(h.category));

    const scores: Record<string, number> = {};
    if (opts.rulesOnly) {
      // AI paused (FR-20): no model calls; only deterministic rules decide routing.
      const base0 = { rulesHit: hits.map((h) => `${h.category}:${h.src}`), requestHuman, emotionHigh, scores };
      if (mandatoryHit) return { ...base0, category: mandatoryHit.category, probability: 1, method: "rule" };
      if (emotionHigh) return { ...base0, category: "keluhan_berat", probability: 1, method: "rule" };
      return { ...base0, category: hits[0]?.category ?? "lainnya", probability: hits[0] ? 0.6 : 0, method: hits[0] ? "rule" : "none" };
    }
    const [vector] = await this.embedder.embed([text]);
    for (const ev of this.exampleVectors) {
      const s = cosine(vector!, ev.vector);
      if (s > (scores[ev.category] ?? -1)) scores[ev.category] = s;
    }

    const base = { rulesHit: hits.map((h) => `${h.category}:${h.src}`), requestHuman, emotionHigh, scores };
    if (mandatoryHit) return { ...base, category: mandatoryHit.category, probability: 1, method: "rule" };
    if (emotionHigh) return { ...base, category: "keluhan_berat", probability: 1, method: "rule" };

    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const best = entries[0];
    if (!best || best[1] < this.config.minSimilarity) {
      const ruleCat = hits[0]?.category;
      if (ruleCat) return { ...base, category: ruleCat, probability: 0.6, method: "rule" };
      return { ...base, category: "lainnya", probability: 0, method: "none" };
    }
    const t = this.config.temperature;
    const exps = entries.map(([, s]) => Math.exp((s - best[1]) / t));
    const z = exps.reduce((a, b) => a + b, 0);
    return { ...base, category: best[0] as Category, probability: exps[0]! / z, method: "examples" };
  }
}

function shoutingRatio(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 12) return 0;
  return letters.replace(/[^A-Z]/g, "").length / letters.length;
}
