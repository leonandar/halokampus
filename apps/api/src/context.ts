import type { IntentClassifier, LlmRouter, EmbeddingProvider } from "@hk/ai";
import type { PrismaClient } from "@hk/db";
import type { Clock } from "@hk/domain";
import type { Role } from "@hk/shared";
import type { AppConfig } from "./config.js";
import type { Crypto } from "./crypto.js";
import type { Env } from "./env.js";
import type { ChannelRegistry } from "./channels/types.js";
import type { ParamService } from "./services/params.js";
import type { PmbAdapter } from "./services/pmb.js";
import type { Mailer } from "./services/mailer.js";

/** Real-time fan-out to consoles and customer widgets (Socket.IO in production, recorder in tests). */
export interface Realtime {
  toStaff(event: string, payload: unknown, opts?: { roles?: Role[] }): void;
  toCustomer(customerId: string, event: string, payload: unknown): void;
}

export interface Ctx {
  env: Env;
  db: PrismaClient;
  clock: Clock;
  crypto: Crypto;
  config: AppConfig;
  params: ParamService;
  llm: LlmRouter;
  embedder: EmbeddingProvider;
  intents: IntentClassifier;
  channels: ChannelRegistry;
  realtime: Realtime;
  mailer: Mailer;
  pmb: PmbAdapter;
  /** Runs (inline) or enqueues (worker) the AI pipeline for an inbound message. */
  dispatchAi(messageId: string): Promise<void>;
}
