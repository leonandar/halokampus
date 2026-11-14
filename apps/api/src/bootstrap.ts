import {
  AnthropicProvider,
  IntentClassifier,
  LlmRouter,
  MockEmbedding,
  MockProvider,
  OllamaEmbedding,
  OllamaProvider,
  OpenAICompatibleEmbedding,
  OpenAICompatibleProvider,
  type EmbeddingProvider,
  type LLMProvider,
  type LlmTask,
} from "@hk/ai";
import { PrismaClient } from "@hk/db";
import { systemClock, type Clock } from "@hk/domain";
import { WebChannel } from "./channels/web.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { MetaChannel } from "./channels/meta.js";
import { TelegramChannel } from "./channels/telegram.js";
import { EmailChannel } from "./channels/email.js";
import { PhoneChannel } from "./channels/phone.js";
import { loadConfig } from "./config.js";
import type { Ctx, Realtime } from "./context.js";
import { Crypto } from "./crypto.js";
import type { Env } from "./env.js";
import { SmtpMailer, type Mailer } from "./services/mailer.js";
import { ParamService } from "./services/params.js";
import { HttpPmbAdapter, type PmbAdapter } from "./services/pmb.js";

export const nullRealtime: Realtime = { toStaff() {}, toCustomer() {} };

export function buildProviders(env: Env): Record<string, LLMProvider> {
  const p: Record<string, LLMProvider> = { mock: new MockProvider() };
  if (env.ANTHROPIC_API_KEY) p.anthropic = new AnthropicProvider(env.ANTHROPIC_MODEL, env.ANTHROPIC_API_KEY, env.ANTHROPIC_EFFORT);
  if (env.OLLAMA_MODEL) p.ollama = new OllamaProvider(env.OLLAMA_MODEL, env.OLLAMA_BASE_URL);
  if (env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_MODEL)
    p.openai_compatible = new OpenAICompatibleProvider(env.OPENAI_COMPAT_MODEL, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY, env.OPENAI_COMPAT_LOCATION);
  return p;
}

export function buildEmbedder(env: Env): EmbeddingProvider {
  if (env.EMBEDDING_PROVIDER === "ollama" && env.OLLAMA_EMBED_MODEL) return new OllamaEmbedding(env.OLLAMA_EMBED_MODEL, env.OLLAMA_BASE_URL);
  if (env.EMBEDDING_PROVIDER === "openai_compatible" && env.OPENAI_COMPAT_BASE_URL && env.OPENAI_COMPAT_EMBED_MODEL)
    return new OpenAICompatibleEmbedding(env.OPENAI_COMPAT_EMBED_MODEL, env.OPENAI_COMPAT_BASE_URL, env.OPENAI_COMPAT_API_KEY, env.OPENAI_COMPAT_LOCATION);
  return new MockEmbedding();
}

/** Applies PRM-20 (per-agent provider chains) to the router. Unknown provider ids are ignored. */
export async function refreshLlmChains(ctx: Pick<Ctx, "params" | "llm">): Promise<void> {
  const cfg: Record<string, string[] | undefined> = await ctx.params.get<Record<string, string[]>>("PRM-20").catch(() => ({ default: ["mock"] }));
  const known = new Set(ctx.llm.providerIds());
  const pick = (ids: string[] | undefined) => (ids ?? []).filter((id) => known.has(id));
  const def = pick(cfg.default);
  const chains: Partial<Record<LlmTask, string[]>> = {};
  for (const t of ["answer", "summarize", "draft", "classify"] as LlmTask[]) if (cfg[t]) chains[t] = pick(cfg[t]);
  ctx.llm.setChains(chains, def.length ? def : ["mock"]);
}

export interface ContextOverrides {
  clock?: Clock;
  realtime?: Realtime;
  mailer?: Mailer;
  pmb?: PmbAdapter;
  providers?: Record<string, LLMProvider>;
  db?: PrismaClient;
  dispatchAi?: (ctx: Ctx, messageId: string) => Promise<void>;
}

export async function createContext(env: Env, o: ContextOverrides = {}): Promise<Ctx> {
  const db = o.db ?? new PrismaClient();
  const clock = o.clock ?? systemClock;
  const config = loadConfig(env.CONFIG_DIR);
  const embedder = buildEmbedder(env);
  const intents = new IntentClassifier(config.intents, embedder);
  await intents.init();
  const realtime = o.realtime ?? nullRealtime;
  const ctx: Ctx = {
    env,
    db,
    clock,
    crypto: new Crypto(env.DATA_ENCRYPTION_KEY, env.BLIND_INDEX_KEY),
    config,
    params: new ParamService(db, clock),
    llm: new LlmRouter(o.providers ?? buildProviders(env), {}, ["mock"]),
    embedder,
    intents,
    channels: {},
    realtime,
    mailer: o.mailer ?? new SmtpMailer(env.SMTP_HOST, env.SMTP_PORT, env.SMTP_FROM),
    pmb: o.pmb ?? new HttpPmbAdapter(env.PMB_API_URL),
    dispatchAi: async () => {},
  };
  ctx.channels = {
    web: new WebChannel({ toStaff: (...a) => ctx.realtime.toStaff(...a), toCustomer: (...a) => ctx.realtime.toCustomer(...a) }),
    whatsapp: new WhatsAppChannel(env.WHATSAPP_MODE, db, env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN ? { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, accessToken: env.WHATSAPP_ACCESS_TOKEN } : undefined),
    messenger: new MetaChannel("messenger", env.META_MODE, db, env.META_PAGE_ACCESS_TOKEN),
    instagram: new MetaChannel("instagram", env.META_MODE, db, env.META_PAGE_ACCESS_TOKEN),
    telegram: new TelegramChannel(env.TELEGRAM_MODE, db, env.TELEGRAM_BOT_TOKEN),
    email: new EmailChannel(env.EMAIL_MODE, db, ctx.mailer),
    phone: new PhoneChannel(),
  };
  const { processInboundMessage } = await import("./services/pipeline.js");
  ctx.dispatchAi = o.dispatchAi
    ? (id) => o.dispatchAi!(ctx, id)
    : async (id) => {
        await refreshLlmChains(ctx);
        await processInboundMessage(ctx, id);
      };
  return ctx;
}
