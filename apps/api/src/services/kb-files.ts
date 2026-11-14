import mammoth from "mammoth";

/**
 * PDF text via the official pdf.js (legacy Node build). pdf-parse 1.1.1 was dropped in
 * Phase 4: its bundled 2017 pdf.js returned random "bad XRef entry" failures on valid PDFs.
 */
async function pdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let page = "";
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) page += (item.str ?? "") + (item.hasEOL ? "\n" : "");
    pages.push(page);
  }
  await doc.destroy();
  return pages.join("\n");
}

/**
 * Turns an uploaded PDF/DOCX/TXT/MD into knowledge-base Markdown (FR-33). Headings are
 * detected heuristically (short lines without a final period, numbered "1." / "BAB"),
 * otherwise text is chunked into ~900-character sections named "Bagian n".
 */
export async function fileToText(filename: string, mime: string, buf: Buffer): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") {
    try {
      return await pdfText(buf);
    } catch {
      throw Object.assign(new Error("Berkas PDF tidak dapat dibaca (rusak atau terenkripsi)"), { status: 400, code: "unreadable_pdf" });
    }
  }
  if (ext === "docx" || mime.includes("wordprocessingml")) {
    try {
      return (await mammoth.extractRawText({ buffer: buf })).value;
    } catch {
      throw Object.assign(new Error("Berkas DOCX tidak dapat dibaca"), { status: 400, code: "unreadable_docx" });
    }
  }
  if (ext === "md" || ext === "txt" || mime.startsWith("text/")) return buf.toString("utf8");
  throw Object.assign(new Error("Format berkas tidak didukung (PDF, DOCX, TXT, MD)"), { status: 400, code: "unsupported_format" });
}

const isHeading = (l: string) => l.length >= 3 && l.length <= 80 && !/[.,;:]$/.test(l) && (/^(BAB|Bab|Pasal|\d+(\.\d+)*\.?\s)/.test(l) || (/^[A-Z]/.test(l) && l.split(/\s+/).length <= 8));

export function textToKbMarkdown(text: string, meta: { title: string; effectiveFrom?: string | null; effectiveTo?: string | null }): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  const sections: Array<{ heading: string; body: string[] }> = [];
  let cur: { heading: string; body: string[] } | null = null;
  let n = 0;
  for (const l of lines) {
    if (!l) continue;
    if (/^#{1,3}\s/.test(l) || isHeading(l)) {
      cur = { heading: l.replace(/^#{1,3}\s+/, ""), body: [] };
      sections.push(cur);
      continue;
    }
    if (!cur || cur.body.join(" ").length > 900) {
      cur = { heading: `Bagian ${++n}`, body: [] };
      sections.push(cur);
    }
    cur.body.push(l);
  }
  const fm = [`title: ${JSON.stringify(meta.title)}`, meta.effectiveFrom ? `effective_from: ${meta.effectiveFrom}` : null, meta.effectiveTo ? `effective_to: ${meta.effectiveTo}` : null].filter(Boolean).join("\n");
  const body = sections.filter((s) => s.body.length).map((s) => `# ${s.heading}\n${s.body.join(" ")}`).join("\n\n");
  return `---\n${fm}\n---\n${body}\n`;
}
