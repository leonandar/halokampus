import type { AuthorityClass } from "@hk/shared";
import { classifyAction, type AuthorityRule } from "@hk/domain";

export interface GuardConfig {
  rules: AuthorityRule[];
  forbiddenOutputPatterns: Array<{ pattern: string; reason: string }>;
  forbiddenDataRequestPatterns: Array<{ pattern: string; reason: string }>;
}

export interface GuardInput {
  actionKey: string;
  outputText?: string;
  citationCount?: number;
}

export interface GuardResult {
  passed: boolean;
  authorityClass: AuthorityClass;
  violations: string[];
}

/**
 * Policy guard agent (FR-15). Deterministic and outside the answering LLM, so a prompt
 * injection that fools the LLM still cannot pass this check (NFR-06, ADR-05).
 */
export function runGuard(input: GuardInput, cfg: GuardConfig): GuardResult {
  const authorityClass = classifyAction(input.actionKey, cfg.rules);
  const violations: string[] = [];
  if (authorityClass !== "allowed") violations.push(`Tindakan "${input.actionKey}" berkelas ${authorityClass}`);
  if (input.actionKey === "kb.answer" && (input.citationCount ?? 0) < 1) violations.push("Jawaban tanpa rujukan sumber");
  const text = input.outputText ?? "";
  for (const p of [...cfg.forbiddenOutputPatterns, ...cfg.forbiddenDataRequestPatterns]) {
    if (new RegExp(p.pattern, "i").test(text)) violations.push(p.reason);
  }
  return { passed: violations.length === 0, authorityClass, violations };
}
