"use client";
import { useEffect, useState } from "react";
import { Doc } from "@/components/Icons";

/** Secure upload check reached from channels whose attachments are not fetched (FR-56). */
export default function UploadCheck() {
  const [token, setToken] = useState<string | null>(null);
  const [rules, setRules] = useState<Array<{ docType: string; label: string; extensions: string[]; maxBytes: number }>>([]);
  const [docType, setDocType] = useState("");
  const [result, setResult] = useState<{ ok: boolean; problems: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    setToken(t);
    if (!t) return;
    fetch("/public/upload-info", { headers: { authorization: `Bearer ${t}` } })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).message))))
      .then((d) => { setRules(d.rules); setDocType(d.rules[0]?.docType ?? ""); })
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file || !token) return;
    const fd = new FormData();
    fd.append("docType", docType);
    fd.append("file", file);
    const r = await fetch("/public/files", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: fd });
    const d = await r.json();
    if (!r.ok) setError(d.message);
    else setResult(d);
  }
  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold"><Doc />Periksa berkas</h1>
      <p className="mb-4 text-sm text-[var(--color-muted)]">haloK@MPUS hanya memeriksa format dan ukuran; berkas tidak disimpan. Unggah berkas resmi tetap melalui portal pendaftaran. Hasil juga dikirim ke percakapan Anda.</p>
      {error ? <p role="alert" className="mb-3 rounded bg-[var(--color-danger-soft)] p-3 text-[var(--color-danger)]">{error}</p> : null}
      {rules.length ? (
        <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
          <label htmlFor="dt" className="text-sm font-semibold">Jenis dokumen</label>
          <select id="dt" className="field" value={docType} onChange={(e) => setDocType(e.target.value)}>{rules.map((r) => <option key={r.docType} value={r.docType}>{r.label} ({r.extensions.join(", ")}, maks. {(r.maxBytes / 1048576).toFixed(1)} MB)</option>)}</select>
          <label htmlFor="file" className="text-sm font-semibold">Berkas</label>
          <input id="file" name="file" type="file" className="field" required />
          <button type="submit" className="btn btn-primary">Periksa</button>
        </form>
      ) : null}
      {result ? <div role="status" className={`mt-4 rounded p-3 ${result.ok ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "bg-[var(--color-warn-soft)] text-[var(--color-warn)]"}`}>{result.ok ? "Berkas memenuhi syarat format dan ukuran." : `Belum memenuhi syarat: ${result.problems.join("; ")}`}</div> : null}
    </main>
  );
}
