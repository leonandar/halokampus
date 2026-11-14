import type { LLMProvider, LlmRequest } from "./llm.js";

interface MockChunk {
  id: string;
  title: string;
  section?: string;
  content: string;
  similarity: number;
}

function firstSentences(text: string, n: number): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  return parts.slice(0, n).join(" ");
}

/**
 * Deterministic provider for tests and offline development (FR-19). It never invents
 * content: answers are extractive quotes of the retrieved chunks, and its
 * self-assessment is derived from retrieval similarity so tests are reproducible.
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly model = "mock-extractive-v1";
  readonly location = "local" as const;

  async complete(req: LlmRequest) {
    const ctx = req.context;
    let json: Record<string, unknown>;
    switch (req.task) {
      case "answer": {
        const chunks = (ctx.chunks as MockChunk[] | undefined) ?? [];
        const top = chunks[0];
        if (!top) {
          json = { answer: "Maaf, saya belum menemukan informasi itu di pedoman resmi.", self_confidence: 0.1, used_chunk_ids: [] };
        } else {
          json = {
            answer: `${firstSentences(top.content, 2)}`,
            self_confidence: Math.min(0.95, 0.5 + top.similarity * 0.5),
            used_chunk_ids: [top.id],
          };
        }
        break;
      }
      case "summarize": {
        const msgs = (ctx.messages as Array<{ sender: string; body: string }> | undefined) ?? [];
        const lastCustomer = [...msgs].reverse().find((m) => m.sender === "customer");
        json = {
          summary: `Pelanggan menanyakan: "${(lastCustomer?.body ?? "").slice(0, 160)}". Kategori: ${String(ctx.category ?? "-")}. Alasan eskalasi: ${String(ctx.reason ?? "-")}.`,
          customer_need: (lastCustomer?.body ?? "").slice(0, 160),
          already_provided: msgs.filter((m) => m.sender === "customer").length,
        };
        break;
      }
      case "draft": {
        const chunks = (ctx.chunks as MockChunk[] | undefined) ?? [];
        const top = chunks[0];
        json = {
          draft: top
            ? `Halo Kak, terima kasih sudah menunggu. ${firstSentences(top.content, 2)} Apakah ada yang masih bisa kami bantu?`
            : "Halo Kak, terima kasih sudah menunggu. Kami sedang memeriksa pertanyaan Kakak dan akan segera mengabari.",
          used_chunk_ids: top ? [top.id] : [],
        };
        break;
      }
      case "classify": {
        json = { intent: String(ctx.fallbackIntent ?? "lainnya"), emotion_high: false };
        break;
      }
    }
    return { json, provider: this.id, model: this.model, location: this.location };
  }
}
