import yaml from "js-yaml";

export interface KbSection {
  heading: string;
  scope: Record<string, string>;
  content: string;
}

export interface ParsedKbDocument {
  title: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  scope: Record<string, string>;
  sections: KbSection[];
}

/**
 * Parses a knowledge-base Markdown document: YAML front matter + one chunk per heading.
 * A heading may end with `{key=value,...}` to scope that section, e.g.
 * `# Syarat TI {program=S1-TI}` (Filtering, FR-13).
 */
export function parseKbMarkdown(source: string): ParsedKbDocument {
  let body = source.replace(/\r\n/g, "\n");
  let meta: Record<string, unknown> = {};
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    meta = (yaml.load(fm[1]!) as Record<string, unknown>) ?? {};
    body = body.slice(fm[0].length);
  }
  const sections: KbSection[] = [];
  let current: KbSection | null = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^#{1,3}\s+(.*?)\s*(\{([^}]*)\})?\s*$/);
    if (h) {
      if (current && current.content.trim()) sections.push(current);
      current = { heading: h[1]!.trim(), scope: parseScope(h[3]), content: "" };
    } else {
      if (!current) current = { heading: String(meta.title ?? "Pendahuluan"), scope: {}, content: "" };
      current.content += `${line}\n`;
    }
  }
  if (current && current.content.trim()) sections.push(current);
  for (const s of sections) s.content = s.content.trim();
  const dateStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v) : null);
  return {
    title: String(meta.title ?? sections[0]?.heading ?? "Tanpa judul"),
    effectiveFrom: dateStr(meta.effective_from),
    effectiveTo: dateStr(meta.effective_to),
    scope: (meta.scope as Record<string, string>) ?? {},
    sections,
  };
}

function parseScope(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw
      .split(",")
      .map((kv) => kv.split("=").map((x) => x.trim()))
      .filter((kv): kv is [string, string] => kv.length === 2 && Boolean(kv[0]) && Boolean(kv[1])),
  );
}
