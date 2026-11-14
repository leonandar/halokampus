import type { AuthorityClass } from "@hk/shared";

export interface AuthorityRule {
  actionKey: string;
  authorityClass: AuthorityClass;
  description?: string;
}

/**
 * Looks up the authority class of an AI action (FR-04). Unknown actions are
 * `forbidden`: the policy guard fails closed.
 */
export function classifyAction(actionKey: string, rules: AuthorityRule[]): AuthorityClass {
  return rules.find((r) => r.actionKey === actionKey)?.authorityClass ?? "forbidden";
}
