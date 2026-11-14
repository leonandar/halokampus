import { z } from "zod";

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATA_ENCRYPTION_KEY: z.string().min(40, "DATA_ENCRYPTION_KEY must be base64 of 32 bytes"),
  BLIND_INDEX_KEY: z.string().min(40),
  RESEARCH_PSEUDONYM_KEY: z.string().min(40).optional(),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default("http://localhost:4000"),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: bool,
  AI_INLINE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  ENABLE_SIMULATORS: bool,
  /** Only for the automated test suite; never disable in production. */
  DISABLE_RATE_LIMIT: bool,
  CONFIG_DIR: z.string().default("../../config"),
  PMB_API_URL: z.string().default(""),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_FROM: z.string().default("haloK@MPUS <no-reply@halokampus.local>"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().optional(),
  OLLAMA_EMBED_MODEL: z.string().optional(),
  OPENAI_COMPAT_BASE_URL: z.string().optional(),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().optional(),
  OPENAI_COMPAT_EMBED_MODEL: z.string().optional(),
  OPENAI_COMPAT_LOCATION: z.enum(["local", "external"]).default("local"),
  EMBEDDING_PROVIDER: z.enum(["mock", "ollama", "openai_compatible"]).default("mock"),
  WHATSAPP_MODE: z.enum(["simulator", "cloud_api"]).default("simulator"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_MODE: z.enum(["simulator", "graph"]).default("simulator"),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  TELEGRAM_MODE: z.enum(["simulator", "bot_api"]).default("simulator"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_MODE: z.enum(["simulator", "smtp"]).default("simulator"),
  EMAIL_WEBHOOK_TOKEN: z.string().optional(),
  REALTIME_REDIS: bool,
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const empty = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return schema.parse(empty);
}

/**
 * Refuses to start a production process with development settings (Phase 4 hardening).
 * Returns the list of problems; server.ts exits when it is not empty.
 */
export function productionProblems(env: Env, nodeEnv = process.env.NODE_ENV): string[] {
  if (nodeEnv !== "production") return [];
  const p: string[] = [];
  if (env.ENABLE_SIMULATORS) p.push("ENABLE_SIMULATORS harus false di produksi");
  if (env.DISABLE_RATE_LIMIT) p.push("DISABLE_RATE_LIMIT tidak boleh true di produksi");
  if (!env.COOKIE_SECURE) p.push("COOKIE_SECURE harus true (HTTPS) di produksi");
  for (const k of ["DATA_ENCRYPTION_KEY", "BLIND_INDEX_KEY", "RESEARCH_PSEUDONYM_KEY"] as const) if (!env[k] || String(env[k]).startsWith("GANTI")) p.push(`${k} belum diatur`);
  if (env.WHATSAPP_MODE === "cloud_api" && !env.WHATSAPP_APP_SECRET) p.push("WHATSAPP_APP_SECRET wajib untuk verifikasi webhook");
  if (env.META_MODE === "graph" && !env.META_APP_SECRET) p.push("META_APP_SECRET wajib untuk verifikasi webhook");
  if (env.TELEGRAM_MODE === "bot_api" && !env.TELEGRAM_WEBHOOK_SECRET) p.push("TELEGRAM_WEBHOOK_SECRET wajib");
  if (!env.EMAIL_WEBHOOK_TOKEN) p.push("EMAIL_WEBHOOK_TOKEN wajib untuk webhook email");
  return p;
}
