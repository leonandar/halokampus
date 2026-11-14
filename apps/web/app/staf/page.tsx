"use client";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { ChannelBadge, TicketWorkspace } from "@/components/TicketWorkspace";
import { useStaff, type StaffUser } from "@/components/useStaff";
import { useStaffSocket } from "@/components/useStaffSocket";
import { Bot, Doc, Pause, Play, Shield, Undo } from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import { CHANNEL_LABEL, pct, time } from "@/lib/format";
import { CpSupervisionPanel, DsrPanel, OrchestrationPanel, QaPanel } from "@/components/Governance";

const TABS = [
  ["antrean", "Antrean Tingkat 3"],
  ["inbox", "Kotak masuk terpadu"],
  ["supervisi", "Supervisi AI"],
  ["kendali", "Jeda AI"],
  ["audit", "Jejak audit"],
  ["kb", "Basis pengetahuan"],
  ["qa", "QA review"],
  ["cp", "Supervisi CP"],
  ["siklus", "Siklus orkestrasi"],
  ["dsr", "Hak data"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function StaffConsole() {
  const { user } = useStaff(["staff"]);
  const [tab, setTab] = useState<Tab>("antrean");
  return (
    <StaffShell user={user} title="Konsol Staf PMB · Tingkat 3 & Orkestrasi">
      <div role="tablist" aria-label="Fungsi Staf PMB" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className={`btn ${tab === id ? "btn-primary" : "btn-ghost"}`}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {user && tab === "antrean" ? <TicketWorkspace user={user} tier="T3" mode="staff" /> : null}
        {user && tab === "inbox" ? <TicketWorkspace user={user} tier="all" mode="staff" /> : null}
        {user && tab === "supervisi" ? <Supervision /> : null}
        {user && tab === "kendali" ? <AiControl /> : null}
        {user && tab === "audit" ? <Audit /> : null}
        {user && tab === "kb" ? <KnowledgeBase user={user} /> : null}
        {user && tab === "qa" ? <QaPanel /> : null}
        {user && tab === "cp" ? <CpSupervisionPanel /> : null}
        {user && tab === "siklus" ? <OrchestrationPanel canManage /> : null}
        {user && tab === "dsr" ? <DsrPanel /> : null}
      </div>
    </StaffShell>
  );
}

// ------------------------------------------------------------------ supervision + override
function Supervision() {
  const [items, setItems] = useState<any[]>([]);
  const [causes, setCauses] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<any>(null);
  const load = useCallback(async () => {
    const r = await api("/api/supervision/feed?limit=50");
    setItems(r.items);
    setCauses(r.causes);
  }, []);
  useEffect(() => void load(), [load]);
  useStaffSocket(["ai.action"], () => void load());
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="card p-4" aria-labelledby="feed-h">
        <h2 id="feed-h" className="mb-3 flex items-center gap-2 text-base font-bold"><Bot />Umpan tindakan AI waktu nyata</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-muted)]">
              <tr><th className="p-2">Waktu</th><th className="p-2">Tiket</th><th className="p-2">Kanal</th><th className="p-2">Tindakan</th><th className="p-2">Keyakinan</th><th className="p-2">Hasil</th><th className="p-2">Penyedia</th><th className="p-2"><span className="sr-only">Aksi</span></th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-[var(--color-line)] align-top">
                  <td className="p-2 whitespace-nowrap">{time(a.createdAt)}</td>
                  <td className="p-2">{a.ticketNumber ? `#${a.ticketNumber}` : "–"}</td>
                  <td className="p-2">{a.channel ? <ChannelBadge code={a.channel} /> : "–"}</td>
                  <td className="p-2"><div className="font-semibold">{a.actionType}</div><div className="text-xs text-[var(--color-muted)]">{a.category}</div>{a.output ? <div className="mt-1 max-w-[340px] text-xs">{a.output}</div> : null}</td>
                  <td className="p-2"><ConfidenceBar value={a.confidence} components={a.components?.components} /></td>
                  <td className="p-2"><OutcomeBadge outcome={a.outcome} reason={a.routing?.reason} />{a.guard?.violations?.length ? <div className="mt-1 text-xs text-[var(--color-danger)]">{a.guard.violations.join("; ")}</div> : null}</td>
                  <td className="p-2 text-xs">{a.provider ?? "–"}{a.location ? ` (${a.location === "local" ? "lokal" : "eksternal"})` : ""}{a.latencyMs !== null ? ` · ${a.latencyMs} ms` : ""}</td>
                  <td className="p-2">{a.outcome === "sent" ? <button type="button" className="btn btn-ghost" onClick={() => setTarget(a)}><Undo />Override</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length === 0 ? <p className="py-6 text-center text-sm text-[var(--color-muted)]">Belum ada tindakan AI.</p> : null}
        </div>
      </section>
      <OverrideForm target={target} causes={causes} onDone={() => { setTarget(null); void load(); }} />
    </div>
  );
}

function ConfidenceBar({ value, components }: { value: number | null; components?: { retrieval: number; intent: number; self: number } }) {
  if (value === null || value === undefined) return <span className="text-[var(--color-muted)]">–</span>;
  const low = value < 0.75;
  return (
    <div className="w-32">
      <div className="flex justify-between text-xs"><span className={low ? "font-bold text-[var(--color-danger)]" : "font-bold"}>{pct(value)}</span></div>
      <div className="mt-1 h-2 rounded bg-slate-200" aria-hidden="true"><div className={`h-2 rounded ${low ? "bg-[var(--color-danger)]" : "bg-[var(--color-ok)]"}`} style={{ width: `${Math.round(value * 100)}%` }} /></div>
      {components ? <div className="mt-1 text-[11px] leading-tight text-[var(--color-muted)]">ret {pct(components.retrieval)} · niat {pct(components.intent)} · diri {pct(components.self)}</div> : null}
    </div>
  );
}

function OutcomeBadge({ outcome, reason }: { outcome: string; reason?: string }) {
  const map: Record<string, [string, string]> = {
    sent: ["Terkirim", "bg-[var(--color-ok-soft)] text-[var(--color-ok)]"],
    escalated: ["Dieskalasi", "bg-[var(--color-warn-soft)] text-[var(--color-warn)]"],
    blocked: ["Diblokir penjaga", "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"],
    overridden: ["Di-override", "bg-[var(--color-ai-soft)] text-[var(--color-ai)]"],
  };
  const [label, cls] = map[outcome] ?? [outcome, "bg-slate-100"];
  return <span className={`badge ${cls}`}>{label}{reason ? ` · ${reason}` : ""}</span>;
}

function OverrideForm({ target, causes, onDone }: { target: any; causes: Record<string, string>; onDone: () => void }) {
  const [type, setType] = useState("replace");
  const [cause, setCause] = useState("");
  const [reason, setReason] = useState("");
  const [replacement, setReplacement] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReplacement(target?.output ?? "");
    setError(null);
  }, [target]);
  if (!target) {
    return <aside className="card p-4 text-sm text-[var(--color-muted)]"><h2 className="mb-2 flex items-center gap-2 text-base font-bold text-[var(--color-ink)]"><Shield />Override</h2>Pilih tombol Override pada tindakan AI yang terkirim. Alasan dan kategori penyebab wajib diisi; setiap override tercatat di jejak audit.</aside>;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/ai-actions/${target.id}/override`, { body: { type, cause, reason, replacement: type === "cancel" ? undefined : replacement, notifyCustomer: notify } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <aside className="card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold"><Shield />Override tindakan AI</h2>
      <p className="mb-3 text-xs text-[var(--color-muted)]">Tiket #{target.ticketNumber} · {target.actionType} · keyakinan {pct(target.confidence)}</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Jenis</legend>
          <div className="flex flex-wrap gap-2">
            {[["cancel", "Batalkan"], ["replace", "Ganti"], ["correct", "Koreksi"]].map(([v, l]) => (
              <label key={v} className="btn btn-ghost has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]"><input type="radio" name="otype" value={v} checked={type === v} onChange={() => setType(v)} className="h-4 w-4" />{l}</label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="ocause" className="text-sm font-semibold">Kategori penyebab (wajib)</label>
        <select id="ocause" className="field" value={cause} onChange={(e) => setCause(e.target.value)} required>
          <option value="">Pilih…</option>
          {Object.entries(causes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label htmlFor="oreason" className="text-sm font-semibold">Alasan (wajib)</label>
        <textarea id="oreason" className="field" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
        {type !== "cancel" ? (
          <>
            <label htmlFor="orepl" className="text-sm font-semibold">{type === "replace" ? "Jawaban pengganti" : "Teks koreksi"}</label>
            <textarea id="orepl" className="field" rows={4} value={replacement} onChange={(e) => setReplacement(e.target.value)} required />
          </>
        ) : null}
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Beri tahu calon mahasiswa</label>
        {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <div className="flex gap-2"><button type="submit" className="btn btn-danger" disabled={!cause || !reason.trim()}>Terapkan override</button><button type="button" className="btn btn-ghost" onClick={onDone}>Batal</button></div>
      </form>
    </aside>
  );
}

// ------------------------------------------------------------------ AI pause
function AiControl() {
  const [channels, setChannels] = useState<any[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setChannels((await api("/api/channels")).items), []);
  useEffect(() => void load(), [load]);
  useStaffSocket(["channels.update"], () => void load());
  async function toggle(channel: string, paused: boolean) {
    setError(null);
    try {
      await api("/api/ai/pause", { body: { channel, paused, reason } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const anyActive = channels.some((c) => !c.aiPaused);
  return (
    <section className="card p-4" aria-labelledby="pause-h">
      <h2 id="pause-h" className="mb-1 text-base font-bold">Jeda AI</h2>
      <p className="mb-3 text-sm text-[var(--color-muted)]">Saat dijeda, AI berhenti menjawab dan tidak memanggil LLM; semua pesan masuk ke antrean manusia. Kategori wajib tetap diarahkan ke Tingkat 3 dengan aturan.</p>
      <label htmlFor="preason" className="text-sm font-semibold">Alasan jeda (wajib saat menjeda)</label>
      <input id="preason" className="field mb-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. Pedoman sedang diperbarui" />
      {error ? <p role="alert" className="mb-2 text-sm text-[var(--color-danger)]">{error}</p> : null}
      <div className="mb-4 flex gap-2">
        <button type="button" className="btn btn-danger" onClick={() => void toggle("all", true)} disabled={!anyActive}><Pause />Jeda semua kanal</button>
        <button type="button" className="btn btn-ghost" onClick={() => void toggle("all", false)}><Play />Aktifkan semua</button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((c) => (
          <li key={c.code} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] p-3">
            <div className="min-w-0">
              <div className="font-semibold">{CHANNEL_LABEL[c.code] ?? c.name}{!c.enabled ? <span className="ml-1 text-xs text-[var(--color-muted)]">(Fase 2)</span> : null}</div>
              <div className={`text-xs ${c.aiPaused ? "text-[var(--color-danger)]" : "text-[var(--color-ok)]"}`}>{c.aiPaused ? `AI dijeda — ${c.aiPausedReason ?? ""}` : "AI aktif"}</div>
            </div>
            <button type="button" className={`btn ml-auto ${c.aiPaused ? "btn-ghost" : "btn-danger"}`} onClick={() => void toggle(c.code, !c.aiPaused)} aria-label={`${c.aiPaused ? "Aktifkan" : "Jeda"} AI di ${CHANNEL_LABEL[c.code]}`}>{c.aiPaused ? <Play /> : <Pause />}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ audit
function Audit() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => void api("/api/audit?limit=200").then((r) => setItems(r.items)), []);
  return (
    <section className="card p-4" aria-labelledby="audit-h">
      <h2 id="audit-h" className="mb-1 text-base font-bold">Jejak audit (append-only)</h2>
      <p className="mb-3 text-sm text-[var(--color-muted)]">Basis data menolak perubahan dan penghapusan; setiap baris terantai dengan hash (verifikasi: <code>pnpm audit:verify</code>).</p>
      <div className="mb-3 flex gap-2"><a className="btn btn-ghost" href="/api/audit/export?format=csv">Ekspor CSV</a><a className="btn btn-ghost" href="/api/audit/export?format=json">Ekspor JSON</a></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-muted)]"><tr><th className="p-2">#</th><th className="p-2">Waktu</th><th className="p-2">Pelaku</th><th className="p-2">Tindakan</th><th className="p-2">Sumber daya</th><th className="p-2">Rincian</th><th className="p-2">Hash</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.seq} className="border-t border-[var(--color-line)] align-top">
                <td className="p-2">{a.seq}</td><td className="p-2 whitespace-nowrap">{time(a.at)}</td><td className="p-2">{a.actorName ?? a.actorType}{a.actorRole ? ` (${a.actorRole})` : ""}</td>
                <td className={`p-2 font-semibold ${a.action === "authz_denied" ? "text-[var(--color-danger)]" : ""}`}>{a.action}</td><td className="p-2 text-xs">{a.resourceType ?? ""} {a.resourceId ? String(a.resourceId).slice(0, 8) : ""}</td>
                <td className="p-2 text-xs"><code>{JSON.stringify(a.detail)}</code></td><td className="p-2 font-mono text-xs">{a.hash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ knowledge base
function KnowledgeBase({ user }: { user: StaffUser }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [slug, setSlug] = useState("");
  const [markdown, setMarkdown] = useState("---\ntitle: \"[DUMMY] Judul dokumen\"\neffective_from: 2026-01-01\neffective_to: 2027-12-31\n---\n# Bagian\nIsi pedoman…");
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setDocs((await api("/api/kb")).items), []);
  useEffect(() => void load(), [load]);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="card p-4" aria-labelledby="kb-h">
        <h2 id="kb-h" className="mb-3 flex items-center gap-2 text-base font-bold"><Doc />Dokumen basis pengetahuan</h2>
        {msg ? <p role="status" className="mb-3 rounded bg-[var(--color-brand-soft)] p-2 text-sm">{msg}</p> : null}
        <ul className="flex flex-col gap-3">
          {docs.map((d) => (
            <li key={d.id} className="rounded-lg border border-[var(--color-line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.title}</span><span className="badge bg-slate-100">v{d.version}</span>
                <span className={`badge ${d.status === "published" ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : d.status === "tested" ? "bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "bg-slate-100"}`}>{({ draft: "Draf", tested: "Lulus uji", published: "Terbit", retired: "Ditarik" } as Record<string, string>)[d.status] ?? d.status}</span>
                <span className="text-xs text-[var(--color-muted)]">{d.chunks} bagian · berlaku {d.effectiveFrom ?? "–"} s.d. {d.effectiveTo ?? "–"}</span>
              </div>
              {d.status === "draft" || d.status === "tested" ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="grow text-sm"><span className="font-semibold">Pertanyaan uji (pisahkan dengan baris baru)</span><textarea className="field mt-1" rows={2} value={questions[d.id] ?? ""} onChange={(e) => setQuestions({ ...questions, [d.id]: e.target.value })} /></label>
                  <button type="button" className="btn btn-ghost" onClick={() => void run(() => api(`/api/kb/${d.id}/test`, { body: { questions: (questions[d.id] ?? "").split("\n").filter(Boolean) } }), "Uji tanya-jawab selesai.")}>Jalankan uji</button>
                  <button type="button" className="btn btn-primary" disabled={d.status !== "tested"} onClick={() => void run(() => api(`/api/kb/${d.id}/publish`, { body: {} }), "Dokumen terbit.")}>Terbitkan</button>
                </div>
              ) : null}
              {d.testReport?.results?.length ? (
                <details className="mt-2 text-sm"><summary className="cursor-pointer text-[var(--color-brand)]">Hasil uji ({d.testReport.results.length})</summary>
                  <ul className="mt-1 list-disc pl-5">{d.testReport.results.map((r: any, i: number) => <li key={i}><strong>{r.question}</strong> → {r.topSection ?? "–"} ({pct(r.similarity)}): {r.answer}</li>)}</ul>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="card p-4" aria-labelledby="kbnew-h">
        <h2 id="kbnew-h" className="mb-2 text-base font-bold">Unggah dokumen/versi baru</h2>
        <p className="mb-2 text-xs text-[var(--color-muted)]">Markdown dengan front matter (title, effective_from, effective_to). Judul bagian boleh diberi cakupan, mis. <code>{"# Syarat TI {program=S1-TI}"}</code>. PDF/DOCX pada Fase 3.</p>
        <label htmlFor="kbslug" className="text-sm font-semibold">Slug (sama dengan dokumen lama = versi baru)</label>
        <input id="kbslug" className="field mb-2" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="mis. 02-biaya" />
        <label htmlFor="kbmd" className="text-sm font-semibold">Isi</label>
        <textarea id="kbmd" className="field mb-2 font-mono text-sm" rows={12} value={markdown} onChange={(e) => setMarkdown(e.target.value)} />
        <button type="button" className="btn btn-primary" disabled={!slug} onClick={() => void run(() => api("/api/kb", { body: { slug, markdown } }), "Draf dibuat. Jalankan uji sebelum terbit.")}>Simpan sebagai draf</button>
        <form className="mt-4 flex flex-col gap-2 border-t border-[var(--color-line)] pt-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("slug", slug);
          void run(async () => {
            const res = await fetch("/api/kb/upload", { method: "POST", body: fd, headers: { "x-csrf-token": sessionStorage.getItem("hk_csrf") ?? "" } });
            const d = await res.json();
            if (!res.ok) throw new Error(d.message);
          }, "Berkas diubah menjadi draf. Periksa bagian-bagiannya lalu jalankan uji.");
        }}>
          <h3 className="text-sm font-bold">Atau unggah PDF/DOCX/TXT</h3>
          <label className="text-sm">Judul<input name="title" className="field mt-1" placeholder="[DUMMY] Judul dokumen" /></label>
          <div className="flex gap-2">
            <label className="grow text-sm">Berlaku dari<input name="effectiveFrom" type="date" className="field mt-1" /></label>
            <label className="grow text-sm">sampai<input name="effectiveTo" type="date" className="field mt-1" /></label>
          </div>
          <label className="text-sm">Berkas<input name="file" type="file" accept=".pdf,.docx,.txt,.md" className="field mt-1" required /></label>
          <div><button type="submit" className="btn btn-ghost" disabled={!slug}>Unggah sebagai draf</button></div>
        </form>
        <p className="mt-2 text-xs text-[var(--color-muted)]">Pengunggah: {user.name}</p>
      </section>
    </div>
  );
}
