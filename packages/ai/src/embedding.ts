import { tokenize } from "./text.js";

export type ProviderLocation = "local" | "external";

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly location: ProviderLocation;
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic hashed bag-of-words embedding (unigrams + bigrams). Only for tests and
 * offline development: similarity ≈ lexical overlap, not semantics.
 */
export class MockEmbedding implements EmbeddingProvider {
  readonly id = "mock";
  readonly model = "mock-hash-bow-512";
  readonly location = "local" as const;
  constructor(private readonly dims = 512) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(this.dims).fill(0);
      const toks = tokenize(t);
      const grams = [...toks, ...toks.slice(1).map((w, i) => `${toks[i]}_${w}`)];
      for (const g of grams) v[fnv1a(g) % this.dims]! += g.includes("_") ? 0.5 : 1;
      const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** Ollama (local) embeddings: POST {baseUrl}/api/embed. */
export class OllamaEmbedding implements EmbeddingProvider {
  readonly id = "ollama";
  readonly location = "local" as const;
  constructor(readonly model: string, private readonly baseUrl: string) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`ollama embed HTTP ${res.status}`);
    const body = (await res.json()) as { embeddings: number[][] };
    return body.embeddings;
  }
}

/** OpenAI-compatible embeddings (OpenAI, vLLM, LM Studio, TEI…): POST {baseUrl}/embeddings. */
export class OpenAICompatibleEmbedding implements EmbeddingProvider {
  readonly id = "openai_compatible";
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly location: ProviderLocation,
  ) {}
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
    const body = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((d) => d.embedding);
  }
}
