"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHANNEL_LABEL, time } from "@/lib/format";
import { Check } from "./Icons";

const wibDay = (offset = 0) => new Date(Date.now() + 7 * 3600_000 - offset * 86400_000).toISOString().slice(0, 10);

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    }
  };
  const view = msg ? <p role={msg.ok ? "status" : "alert"} className={`mb-3 rounded p-2 text-sm ${msg.ok ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}>{msg.text}</p> : null;
  return { run, view };
}

// ------------------------------------------------------------------ QA review (FR-36)
export function QaPanel() {
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [correct, setCorrect] = useState<"" | "true" | "false">("");
  const [note, setNote] = useState("");
  const { run, view } = useAct();
  const load = useCallback(async () => setData(await api(`/api/qa/sample?from=${wibDay(13)}&to=${wibDay(0)}`)), []);
  useEffect(() => void load(), [load]);
  async function openTicket(t: any) {
    setSel({ ...t, detail: await api(`/api/tickets/${t.id}`) });
    setScores({});
    setCorrect("");
    setNote("");
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="card p-4" aria-labelledby="qa-h">
        <h2 id="qa-h" className="mb-1 text-base font-bold">Sampel QA (14 hari terakhir)</h2>
        <p className="mb-2 text-xs text-[var(--color-muted)]">{data?.note}</p>
        <ul className="flex flex-col gap-2">
          {(data?.items ?? []).map((t: any) => (
            <li key={t.id}><button type="button" onClick={() => void openTicket(t)} className={`w-full rounded-lg border p-2 text-left text-sm ${sel?.id === t.id ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-line)]"}`}>#{t.number} · {CHANNEL_LABEL[t.lastChannelCode] ?? t.lastChannelCode} · {t.category}{t.isDummy ? " · DUMMY" : ""}</button></li>
          ))}
          {data && !data.items.length ? <li className="text-sm text-[var(--color-muted)]">Tidak ada tiket selesai yang belum dinilai.</li> : null}
        </ul>
      </section>
      <section className="card p-4" aria-labelledby="qaf-h">
        <h2 id="qaf-h" className="mb-2 text-base font-bold">Formulir QA {data?.form?.version ? <span className="text-xs font-normal text-[var(--color-muted)]">({data.form.version})</span> : null}</h2>
        {view}
        {!sel ? <p className="text-sm text-[var(--color-muted)]">Pilih tiket dari sampel.</p> : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/qa/reviews", { body: { ticketId: sel.id, scores, aiAnswerCorrect: correct === "" ? null : correct === "true", note } }); setSel(null); await load(); }, "Penilaian QA tersimpan."); }}>
            <div className="max-h-64 overflow-y-auto rounded border border-[var(--color-line)] p-2 text-sm">
              {sel.detail.timeline.map((m: any) => <p key={m.id} className="mb-1"><strong>{m.senderLabel}:</strong> {m.text}</p>)}
            </div>
            {data.form.criteria.map((c: any) => (
              <label key={c.id} className="text-sm font-semibold">{c.label} (0–{c.max})
                <input type="number" min={0} max={c.max} className="field mt-1" value={scores[c.id] ?? ""} onChange={(e) => setScores({ ...scores, [c.id]: Number(e.target.value) })} required />
              </label>
            ))}
            <fieldset>
              <legend className="text-sm font-semibold">Jawaban AI pada tiket ini (sumber KPI akurasi AI)</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {[["true", "Benar"], ["false", "Salah"], ["", "Tidak ada jawaban AI"]].map(([v, l]) => <label key={v} className="btn btn-ghost has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]"><input type="radio" name="aicorrect" className="h-4 w-4" checked={correct === v} onChange={() => setCorrect(v as "")} />{l}</label>)}
              </div>
            </fieldset>
            <label className="text-sm font-semibold">Catatan<textarea className="field mt-1" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
            <div><button type="submit" className="btn btn-primary">Simpan penilaian</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ CP supervision (FR-34)
export function CpSupervisionPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [target, setTarget] = useState<string>("");
  const [text, setText] = useState("");
  const { run, view } = useAct();
  const load = useCallback(async () => setItems((await api("/api/supervision/cp")).items), []);
  useEffect(() => void load(), [load]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="card overflow-x-auto p-4" aria-labelledby="cps-h">
        <h2 id="cps-h" className="mb-2 text-base font-bold">Beban kerja Mahasiswa CP (24 jam)</h2>
        <table className="tabular w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-muted)]"><tr><th className="p-2">Nama</th><th className="p-2">Status</th><th className="p-2">Sedang ditangani</th><th className="p-2">Selesai</th><th className="p-2">Diteruskan</th><th className="p-2">Umpan balik belum dibaca</th></tr></thead>
          <tbody>{items.map((c) => <tr key={c.id} className="border-t border-[var(--color-line)]"><td className="p-2">{c.name}</td><td className="p-2">{c.presence}</td><td className="p-2">{c.openTickets}</td><td className="p-2">{c.resolved24h}</td><td className="p-2">{c.escalated24h}</td><td className="p-2">{c.unreadFeedback}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--color-muted)]">Untuk mengembalikan tiket CP ke antrean atau tiket T3 ke CP, buka tiket di Kotak masuk terpadu.</p>
      </section>
      <form className="card flex flex-col gap-2 p-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/api/cp-feedback", { body: { cpUserId: target, text } }); setText(""); await load(); }, "Umpan balik terkirim."); }}>
        <h2 className="text-base font-bold">Umpan balik kinerja</h2>
        {view}
        <label className="text-sm font-semibold">Mahasiswa CP<select className="field mt-1" value={target} onChange={(e) => setTarget(e.target.value)} required><option value="">Pilih…</option>{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Isi<textarea className="field mt-1" rows={4} value={text} onChange={(e) => setText(e.target.value)} required /></label>
        <div><button type="submit" className="btn btn-primary">Kirim</button></div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ orchestration cycle (FR-35)
export function OrchestrationPanel({ canManage }: { canManage: boolean }) {
  const [cur, setCur] = useState<any>(null);
  const [hist, setHist] = useState<any[]>([]);
  const { run, view } = useAct();
  const load = useCallback(async () => {
    setCur(await api("/api/orchestration/current"));
    setHist((await api("/api/orchestration")).items);
  }, []);
  useEffect(() => void load(), [load]);
  const c = cur?.cycle;
  const items = c?.checklist?.items ?? [];
  const fns = [...new Map(items.map((i: any) => [i.fn, i.fnLabel])).entries()] as Array<[string, string]>;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="card p-4" aria-labelledby="orc-h">
        <h2 id="orc-h" className="text-base font-bold">Siklus orkestrasi {cur ? `(${cur.period.cadence === "weekly" ? "mingguan" : "harian"}${cur.period.peak ? ", masa puncak" : ""})` : ""}</h2>
        <p className="mb-3 text-xs text-[var(--color-muted)]">Mulai {cur ? new Date(cur.period.start).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "full" }) : ""} · irama dari PRM-06/PRM-18 · butir dari config/orchestration.yaml</p>
        {view}
        {!c ? <p className="text-sm text-[var(--color-muted)]">Siklus periode ini belum dibuka oleh Staf PMB.</p> : (
          <>
            {fns.map(([fn, label]) => (
              <fieldset key={fn} className="mb-3 rounded-lg border border-[var(--color-line)] p-3">
                <legend className="px-1 text-sm font-bold">{label}</legend>
                {items.filter((i: any) => i.fn === fn).map((i: any) => (
                  <label key={i.id} className="flex min-h-[44px] items-center gap-3 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={i.done} disabled={!canManage || Boolean(c.closedAt)} onChange={(e) => void run(async () => { await api(`/api/orchestration/${c.id}/items/${i.id}`, { body: { done: e.target.checked } }); await load(); }, "Tersimpan.")} />
                    <span>{i.text}{i.doneAt ? <span className="ml-2 text-xs text-[var(--color-muted)]">{time(i.doneAt)}</span> : null}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            {canManage && !c.closedAt ? <button type="button" className="btn btn-primary" onClick={() => void run(async () => { await api(`/api/orchestration/${c.id}/close`, { body: {} }); await load(); }, "Siklus ditutup; nilai KPI periode dilampirkan.")}><Check />Tutup siklus</button> : null}
            {c.closedAt ? <p className="text-sm text-[var(--color-ok)]">Ditutup {time(c.closedAt)} · snapshot KPI tersimpan.</p> : null}
          </>
        )}
      </section>
      <section className="card p-4" aria-labelledby="orh-h">
        <h2 id="orh-h" className="mb-2 text-base font-bold">Riwayat</h2>
        <ul className="text-sm">{hist.map((h) => <li key={h.id} className="border-t border-[var(--color-line)] py-1">{new Date(`${h.periodStart}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium" })} · {h.done}/{h.total} butir {h.closedAt ? "· ditutup" : "· berjalan"}</li>)}</ul>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ data-subject requests (FR-65/66)
export function DsrPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const { run, view } = useAct();
  const load = useCallback(async () => setItems((await api("/api/dsr")).items), []);
  useEffect(() => void load(), [load]);
  return (
    <section className="card p-4" aria-labelledby="dsr-h">
      <h2 id="dsr-h" className="mb-1 text-base font-bold">Permintaan hak subjek data</h2>
      <p className="mb-3 text-xs text-[var(--color-muted)]">Batas waktu dari PRM-13. “Hapus” dijalankan dengan menganonimkan data pribadi; peristiwa KPI (tanpa data pribadi) tetap tersimpan.</p>
      {view}
      <ul className="flex flex-col gap-3">
        {items.map((d) => (
          <li key={d.id} className="rounded-lg border border-[var(--color-line)] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><strong>{d.typeLabel}</strong><span className="badge bg-slate-100">{d.status}</span><span className="text-xs text-[var(--color-muted)]">{d.customer} · {time(d.createdAt)} · batas {d.dueAt ? time(d.dueAt) : "PRM-13 [PERLU DATA]"}</span></div>
            {d.detail ? <p className="mt-1">“{d.detail}”</p> : null}
            {d.status === "open" || d.status === "in_progress" ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="grow text-xs font-semibold">Catatan penyelesaian<input className="field mt-1" value={note[d.id] ?? ""} onChange={(e) => setNote({ ...note, [d.id]: e.target.value })} /></label>
                <button type="button" className="btn btn-ghost" onClick={() => void run(async () => { await api(`/api/dsr/${d.id}`, { body: { status: "in_progress" } }); await load(); }, "Diproses.")}>Proses</button>
                <button type="button" className="btn btn-primary" onClick={() => void run(async () => { await api(`/api/dsr/${d.id}`, { body: { status: "closed", note: note[d.id], execute: d.type === "delete" || d.type === "withdraw" } }); await load(); }, d.type === "delete" ? "Data pribadi dianonimkan; permintaan ditutup." : "Permintaan ditutup.")}>{d.type === "delete" ? "Jalankan penghapusan" : "Selesaikan"}</button>
                <button type="button" className="btn btn-ghost" onClick={() => void run(async () => { await api(`/api/dsr/${d.id}`, { body: { status: "rejected", note: note[d.id] } }); await load(); }, "Ditolak.")}>Tolak</button>
              </div>
            ) : null}
          </li>
        ))}
        {!items.length ? <li className="text-sm text-[var(--color-muted)]">Belum ada permintaan.</li> : null}
      </ul>
      <button type="button" className="btn btn-ghost mt-3" onClick={() => void run(async () => { const r = await api("/api/retention/run", { body: {} }); if (r.skipped) throw new Error(r.skipped); }, "Job retensi selesai.")}>Jalankan job retensi (PRM-08)</button>
    </section>
  );
}
