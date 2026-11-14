/**
 * Replaces personal data with placeholder tokens before text leaves the process for an
 * LLM (FR-68), and restores it in the model output. The mapping never leaves memory.
 */
export interface RedactionResult {
  text: string;
  map: Map<string, string>;
}

interface Pattern {
  kind: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "NIK", re: /\b\d{16}\b/g },
  { kind: "PHONE", re: /(?:\+62|62|0)8[0-9][0-9\s-]{6,12}[0-9]/g },
  { kind: "REGNO", re: /\bPMB-\d{4}-\d{4,8}\b/gi },
];

export function redact(text: string, extraLiterals: Array<{ kind: string; value: string }> = []): RedactionResult {
  const map = new Map<string, string>();
  const counters = new Map<string, number>();
  const tokenFor = (kind: string, value: string) => {
    for (const [tok, v] of map) if (v === value) return tok;
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    const tok = `⟦${kind}_${n}⟧`;
    map.set(tok, value);
    return tok;
  };
  let out = text;
  for (const lit of extraLiterals) {
    if (!lit.value || lit.value.length < 3) continue;
    const escaped = lit.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), (m) => tokenFor(lit.kind, m));
  }
  for (const p of PATTERNS) out = out.replace(p.re, (m) => tokenFor(p.kind, m));
  return { text: out, map };
}

export function restore(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [tok, value] of map) out = out.split(tok).join(value);
  return out;
}

/** True when `text` still contains something that looks like personal data. */
export function containsPii(text: string): boolean {
  return PATTERNS.some((p) => new RegExp(p.re.source, p.re.flags.replace("g", "")).test(text));
}
