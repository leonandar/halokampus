/**
 * Builds docs/SKENARIO-UJI.md from the real test results (Vitest + Playwright JSON),
 * mapping every test to SU-xx/FR-xx, KB-xx, E2E-n and KT-xx tags found in its name.
 * Usage: pnpm test:report   (runs both suites; Docker infra must be up)
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const S = process.env.SCRATCH ?? "/tmp";
execSync(`npx vitest run --reporter=json --outputFile=${S}/vitest.json`, { stdio: "inherit", env: process.env });
try {
  execSync(`npx playwright test --trace off --reporter=json > ${S}/pw.json`, { stdio: ["ignore", "ignore", "inherit"], shell: "/bin/bash", env: process.env });
} catch {
  /* failures are reported below */
}

interface T { suite: string; name: string; status: "passed" | "failed" | "skipped"; ms: number; file: string }
const tests: T[] = [];
const v = JSON.parse(readFileSync(`${S}/vitest.json`, "utf8"));
for (const f of v.testResults) for (const a of f.assertionResults) tests.push({ suite: "Vitest", name: [...a.ancestorTitles, a.title].join(" › "), status: a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped", ms: Math.round(a.duration ?? 0), file: f.name.replace(/^.*\/(apps|packages)\//, "$1/") });
const pw = JSON.parse(readFileSync(`${S}/pw.json`, "utf8"));
const walk = (s: any, path: string[]) => {
  for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) {
    const r = t.results?.at(-1);
    tests.push({ suite: "Playwright", name: [...path, sp.title].filter(Boolean).join(" › "), status: r?.status === "passed" ? "passed" : r?.status === "skipped" ? "skipped" : "failed", ms: r?.duration ?? 0, file: "e2e/flows.spec.ts" });
  }
  for (const c of s.suites ?? []) walk(c, [...path, c.title.endsWith(".ts") ? "" : c.title]);
};
for (const s of pw.suites ?? []) walk(s, []);

const srs = readFileSync("docs/SRS.md", "utf8");
const frTitle = new Map<string, string>();
for (const m of srs.matchAll(/^\| (FR-\d{2}) \| (.+?) \| [^|]* \|$/gm)) frTitle.set(m[1]!, m[2]!.replace(/\*\*/g, "").slice(0, 110));
const kbTitle = new Map<string, string>();
for (const m of srs.matchAll(/^\| (KB-\d{2}) \| (.+?) \| (.+?) \|$/gm)) kbTitle.set(m[1]!, `${m[2]} → ${m[3]}`);

// Tests that cover an FR without carrying its tag in the name.
const EXTRA: Record<string, string[]> = {
  "FR-04": ["policy guard (FR-15)"], "FR-17": ["KB-08", "E2E-1"], "FR-08": ["hand-off package"], "FR-11": ["KB-14"], "FR-13": ["KB parsing"], "FR-16": ["SU-16"],
  "FR-18": ["SU-12/SU-02"], "FR-19": ["LLM router & answer agent (FR-19)"], "FR-22": ["SU-21"], "FR-23": ["SU-03"], "FR-28": ["SU-05"],
  "FR-34": ["CP supervision"], "FR-35": ["orchestration"], "FR-36": ["QA:"], "FR-37": ["SU-37"], "FR-38": ["Fase 3 · FR-38"], "FR-39": ["FR-39"],
  "FR-40": ["target"], "FR-44": ["FR-56 feature parity"], "FR-45": ["E2E-1"], "FR-47": ["instagram:"], "FR-48": ["messenger:"], "FR-49": ["email:"],
  "FR-50": ["telegram:"], "FR-53": ["SU-14 · SU-53"], "FR-57": ["CSAT/CES"], "FR-59": ["KT —"], "FR-61": ["kpi-map"], "FR-62": ["FR-62"],
  "FR-64": ["blocks requests for data outside"], "FR-66": ["retention"], "FR-70": ["status check verifies"],
};
const covers = (fr: string) => {
  const n = Number(fr.slice(3));
  const tag = new RegExp(`\\b(SU-${String(n).padStart(2, "0")}|FR-${String(n).padStart(2, "0")})\\b`);
  return tests.filter((t) => tag.test(t.name) || (EXTRA[fr] ?? []).some((x) => t.name.includes(x)));
};
const mark = (ts: T[]) => (ts.length === 0 ? "— (belum ada uji otomatis)" : ts.every((t) => t.status === "passed") ? `LULUS (${ts.length})` : `GAGAL ${ts.filter((t) => t.status !== "passed").length}/${ts.length}`);
const esc = (s: string) => s.replace(/\|/g, "\\|");

const pass = tests.filter((t) => t.status === "passed").length;
const fail = tests.filter((t) => t.status === "failed").length;
const lines: string[] = [
  "# Skenario & Hasil Uji — haloK@MPUS",
  "",
  `Dibuat otomatis oleh \`pnpm test:report\` pada ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB dari hasil uji yang benar-benar dijalankan (Vitest + Playwright). Jangan disunting manual; jalankan ulang skripnya.`,
  "",
  "## Ringkasan",
  "",
  `| Rangkaian | Jumlah uji | Lulus | Gagal |`,
  `|---|---|---|---|`,
  ...["Vitest", "Playwright"].map((s) => { const x = tests.filter((t) => t.suite === s); return `| ${s} | ${x.length} | ${x.filter((t) => t.status === "passed").length} | ${x.filter((t) => t.status === "failed").length} |`; }),
  `| **Total** | **${tests.length}** | **${pass}** | **${fail}** |`,
  "",
  "Data uji seluruhnya sintetis/`DUMMY`. Penyedia LLM pada uji otomatis adalah `mock` deterministik; uji dengan LLM sungguhan menunggu model/kunci (lihat README).",
  "",
  "## 1. Skenario per kebutuhan fungsional (SU-xx ↔ FR-xx)",
  "",
  "| FR | Kebutuhan | Status | Uji (berkas › nama) |",
  "|---|---|---|---|",
];
for (const [fr, title] of frTitle) {
  const ts = covers(fr);
  lines.push(`| ${fr} | ${esc(title)} | ${mark(ts)} | ${ts.slice(0, 3).map((t) => esc(`${t.file} › ${t.name}`).slice(0, 160)).join("<br>")}${ts.length > 3 ? `<br>… +${ts.length - 3}` : ""} |`);
}
const section = (title: string, re: RegExp, titles?: Map<string, string>) => {
  lines.push("", `## ${title}`, "", "| Kode | Keterangan | Status | Uji |", "|---|---|---|---|");
  const codes = new Set<string>([...(titles?.keys() ?? [])]);
  for (const t of tests) for (const m of t.name.matchAll(re)) codes.add(m[0]);
  for (const c of [...codes].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const ts = tests.filter((t) => new RegExp(`\\b${c}\\b`).test(t.name));
    lines.push(`| ${c} | ${esc(titles?.get(c) ?? ts[0]?.name.split(" › ").at(-1) ?? "")} | ${mark(ts)} | ${ts.map((t) => esc(t.file)).filter((x, i, a) => a.indexOf(x) === i).join(", ")} |`);
  }
};
section("2. Kasus batas (KB-xx, SRS §7)", /KB-\d{2}/g, kbTitle);
section("3. Alur ujung-ke-ujung (E2E)", /E2E-\d/g);
section("4. Rumus KPI dihitung tangan (KT-xx, docs/KPI.md)", /KT-\d{2}/g);
lines.push("", "## 5. Keamanan (Fase 4)", "", "| Uji | Status |", "|---|---|");
for (const t of tests.filter((x) => x.file.endsWith("security.test.ts"))) lines.push(`| ${esc(t.name)} | ${t.status === "passed" ? "LULUS" : "GAGAL"} |`);
lines.push("", "Matriks RBAC teramati lengkap: [`docs/RBAC-MATRIX.md`](RBAC-MATRIX.md).", "", "## 6. Daftar lengkap uji", "", "| Rangkaian | Berkas | Uji | Status | ms |", "|---|---|---|---|---|");
for (const t of tests) lines.push(`| ${t.suite} | ${t.file} | ${esc(t.name)} | ${t.status} | ${t.ms} |`);
writeFileSync("docs/SKENARIO-UJI.md", lines.join("\n") + "\n");
console.log(`SKENARIO-UJI.md: ${tests.length} tests, ${pass} passed, ${fail} failed; FR without automated test: ${[...frTitle.keys()].filter((fr) => covers(fr).length === 0).join(", ") || "none"}`);
