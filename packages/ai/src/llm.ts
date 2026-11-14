import Anthropic from "@anthropic-ai/sdk";
import type { ProviderLocation } from "./embedding.js";

/** Tasks the agents ask an LLM to perform. The mock provider dispatches on this. */
export type LlmTask = "answer" | "summarize" | "draft" | "classify";

export interface LlmRequest {
  task: LlmTask;
  system: string;
  /** User-turn content. Already redacted by the caller for external providers. */
  user: string;
  /** JSON Schema of the expected output object. */
  schema: Record<string, unknown>;
  /** Structured context, used only by the mock provider to stay deterministic. */
  context: Record<string, unknown>;
  maxTokens?: number;
  /** Abort when the PRM-02 budget is exhausted. */
  signal?: AbortSignal;
}

export interface LlmResult {
  json: Record<string, unknown>;
  provider: string;
  model: string;
  location: ProviderLocation;
  latencyMs: number;
}

export interface LLMProvider {
  readonly id: string;
  readonly model: string;
  readonly location: ProviderLocation;
  complete(req: LlmRequest): Promise<Omit<LlmResult, "latencyMs">>;
}

export class LlmError extends Error {}

function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new LlmError("LLM did not return a JSON object");
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new LlmError("LLM JSON is not an object");
  return parsed as Record<string, unknown>;
}

// --------------------------------------------------------------------- Anthropic
/** Claude via the official SDK, with JSON-schema structured output. External provider. */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly location = "external" as const;
  private readonly client: Anthropic;
  constructor(
    readonly model: string,
    apiKey: string | undefined,
    private readonly effort: "low" | "medium" | "high" = "low",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }
  async complete(req: LlmRequest) {
    // Server-side refusal fallback (beta) is on by default; our own LlmRouter chain and
    // the human tiers remain the outer safety net.
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        max_tokens: req.maxTokens ?? 2048,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: {
          effort: this.effort,
          format: { type: "json_schema", schema: req.schema },
        },
      },
      { signal: req.signal },
    );
    if (response.stop_reason === "refusal") throw new LlmError("Anthropic: request declined (refusal)");
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { json: parseJsonObject(text), provider: this.id, model: this.model, location: this.location };
  }
}

// ------------------------------------------------------------ OpenAI-compatible
/** OpenAI / Gemini (OpenAI endpoint) / vLLM / LM Studio / llama.cpp server. */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id = "openai_compatible";
  constructor(
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly location: ProviderLocation,
  ) {}
  async complete(req: LlmRequest) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 2048,
        response_format: { type: "json_schema", json_schema: { name: req.task, schema: req.schema } },
        messages: [
          { role: "system", content: `${req.system}\n\nBalas hanya dengan satu objek JSON sesuai skema.` },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new LlmError(`openai_compatible HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { json: parseJsonObject(body.choices?.[0]?.message?.content ?? ""), provider: this.id, model: this.model, location: this.location };
  }
}

// --------------------------------------------------------------------- Ollama
/** Ollama local LLM: POST {baseUrl}/api/chat with a JSON schema in `format`. */
export class OllamaProvider implements LLMProvider {
  readonly id = "ollama";
  readonly location = "local" as const;
  constructor(readonly model: string, private readonly baseUrl: string) {}
  async complete(req: LlmRequest) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        format: req.schema,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
    });
    if (!res.ok) throw new LlmError(`ollama HTTP ${res.status}`);
    const body = (await res.json()) as { message?: { content?: string } };
    return { json: parseJsonObject(body.message?.content ?? ""), provider: this.id, model: this.model, location: this.location };
  }
}

// ----------------------------------------------------------------------- router
/**
 * Per-agent provider chain with fallback (PRM-20, ADR-11). The first provider that
 * returns valid JSON wins; if all fail the caller routes the message to a human (FR-20).
 */
export class LlmRouter {
  constructor(
    private readonly providers: Record<string, LLMProvider>,
    private chains: Partial<Record<LlmTask, string[]>>,
    private defaultChain: string[],
  ) {}

  /** Applies a new PRM-20 assignment without restarting the process. */
  setChains(chains: Partial<Record<LlmTask, string[]>>, defaultChain: string[]): void {
    this.chains = chains;
    this.defaultChain = defaultChain;
  }

  providerIds(): string[] {
    return Object.keys(this.providers);
  }

  chainFor(task: LlmTask): LLMProvider[] {
    const ids = this.chains[task] ?? this.defaultChain;
    return ids.map((id) => this.providers[id]).filter((p): p is LLMProvider => Boolean(p));
  }

  async complete(req: LlmRequest): Promise<LlmResult & { attempts: Array<{ provider: string; error: string }> }> {
    const attempts: Array<{ provider: string; error: string }> = [];
    for (const p of this.chainFor(req.task)) {
      if (req.signal?.aborted) break;
      const started = performance.now();
      try {
        const r = await p.complete(req);
        return { ...r, latencyMs: Math.round(performance.now() - started), attempts };
      } catch (e) {
        attempts.push({ provider: p.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const err = new LlmError(`All LLM providers failed for task ${req.task}`);
    (err as LlmError & { attempts: unknown }).attempts = attempts;
    throw err;
  }
}
