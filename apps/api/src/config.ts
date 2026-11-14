import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import yaml from "js-yaml";
import type { FileRule, GuardConfig, IntentConfig } from "@hk/ai";

export interface AppConfig {
  dir: string;
  intents: IntentConfig;
  guard: GuardConfig;
  authorityRules: Array<{ action: string; class: string; description?: string }>;
  files: FileRule[];
  templates: Array<{ code: string; title: string; body: string }>;
  allowedData: Array<{ field: string; label: string }>;
  noticeVersion: string;
  parameterDefaults: Record<string, { value: unknown; source: string; label: string }>;
  kbDummyFiles: Array<{ name: string; content: string }>;
  reminders: { leadDays: number; minIntervalHours: number; deadlineCode: string };
  surveys: SurveyDef[];
  actionPatterns: { reschedule: string[] };
  qaForm: { version: string; criteria: Array<{ id: string; label: string; max: number }> };
  orchestration: Array<{ id: string; label: string; items: string[] }>;
  kpiMap: Record<string, string | null>;
}

export interface SurveyDef {
  code: string;
  kind: "post_service" | "usability";
  audience: string[];
  title: string;
  dummy: boolean;
  file: string;
  items: Array<{ id: string; text: string; scale: { min: number; max: number; minLabel?: string; maxLabel?: string } }>;
}

/** Locates the repository `config/` folder regardless of the process working directory. */
export function resolveConfigDir(dir: string): string {
  const candidates = [dir, resolve(process.cwd(), dir), resolve(import.meta.dirname, "../../../config")];
  for (const c of candidates) {
    const p = isAbsolute(c) ? c : resolve(c);
    if (existsSync(join(p, "intents.yaml"))) return p;
  }
  throw new Error(`Config directory not found (tried ${candidates.join(", ")})`);
}

const read = (dir: string, f: string) => yaml.load(readFileSync(join(dir, f), "utf8")) as any;

export function loadConfig(dirInput: string): AppConfig {
  const dir = resolveConfigDir(dirInput);
  const intents = read(dir, "intents.yaml");
  const authority = read(dir, "ai-authority.yaml");
  const pdp = read(dir, "pdp/allowed-data.yaml");
  const kbDir = join(dir, "kb-dummy");
  return {
    dir,
    intents: {
      temperature: intents.temperature,
      minSimilarity: intents.min_similarity,
      humanRequestPatterns: intents.human_request_patterns ?? [],
      emotionPatterns: intents.emotion_patterns ?? [],
      intents: intents.intents,
    },
    authorityRules: authority.rules,
    guard: {
      rules: authority.rules.map((r: any) => ({ actionKey: r.action, authorityClass: r.class, description: r.description })),
      forbiddenOutputPatterns: authority.forbidden_output_patterns ?? [],
      forbiddenDataRequestPatterns: authority.forbidden_data_request_patterns ?? [],
    },
    files: read(dir, "files.yaml").rules,
    templates: read(dir, "templates/tp.yaml").templates,
    allowedData: pdp.allowed,
    noticeVersion: pdp.notice_version,
    parameterDefaults: read(dir, "parameters.default.yaml").parameters,
    reminders: (() => { const r = read(dir, "reminders.yaml"); return { leadDays: r.lead_days, minIntervalHours: r.min_interval_hours, deadlineCode: r.deadline_code }; })(),
    qaForm: read(dir, "qa-form.yaml"),
    orchestration: read(dir, "orchestration.yaml").functions,
    kpiMap: read(dir, "kpi-map.yaml").map ?? {},
    actionPatterns: { reschedule: intents.action_patterns?.reschedule ?? [] },
    surveys: readdirSync(join(dir, "surveys"))
      .filter((f) => f.endsWith(".yaml"))
      .sort()
      .map((f) => {
        const d = read(dir, `surveys/${f}`);
        return { code: d.code, kind: d.kind === "usability" ? "usability" : "post_service", audience: d.audience ?? [], title: d.title, dummy: Boolean(d.dummy), file: `surveys/${f}`, items: d.items ?? [] } as SurveyDef;
      }),
    kbDummyFiles: existsSync(kbDir)
      ? readdirSync(kbDir)
          .filter((f) => f.endsWith(".md"))
          .sort()
          .map((name) => ({ name, content: readFileSync(join(kbDir, name), "utf8") }))
      : [],
  };
}
