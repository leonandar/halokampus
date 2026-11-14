"use client";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { useStaff } from "@/components/useStaff";
import { api } from "@/lib/api";
import { ROLE_LABEL, time } from "@/lib/format";

/** FR-37: every change needs one Pimpinan and one Staf PMB (decision Q5). */
export default function Parameters() {
  const { user } = useStaff(["staff", "leader"]);
  const [rows, setRows] = useState<any[]>([]);
  const [code, setCode] = useState("PRM-01");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setRows((await api("/api/params")).items), []);
  useEffect(() => void (user && load()), [user, load]);
  const active = rows.filter((r) => r.status === "active");
  const pending = rows.filter((r) => r.status === "proposed");
  useEffect(() => {
    const a = active.find((r) => r.code === code);
    if (a) setValue(JSON.stringify(a.value, null, 2));
  }, [code, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
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
    <StaffShell user={user} title="Parameter kebijakan berversi">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card p-4" aria-labelledby="active-h">
          <h2 id="active-h" className="mb-2 text-base font-bold">Parameter aktif</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-muted)]"><tr><th className="p-2">Kode</th><th className="p-2">Parameter</th><th className="p-2">Nilai</th><th className="p-2">Versi</th><th className="p-2">Asal</th></tr></thead>
              <tbody>
                {active.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--color-line)] align-top">
                    <td className="p-2 font-semibold">{r.code}</td><td className="p-2">{r.label}</td>
                    <td className="p-2"><code className="text-xs">{r.value === null ? "[PERLU DATA]" : JSON.stringify(r.value)}</code></td>
                    <td className="p-2">v{r.version}</td>
                    <td className="p-2"><span className={`badge ${r.source === "DUMMY" || r.source === "PERLU DATA" ? "bg-[var(--color-warn-soft)] text-[var(--color-warn)]" : "bg-slate-100"}`}>{r.source}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <section className="card p-4" aria-labelledby="prop-h">
            <h2 id="prop-h" className="mb-1 text-base font-bold">Usulkan perubahan</h2>
            <p className="mb-2 text-xs text-[var(--color-muted)]">Berlaku setelah disetujui orang kedua dengan peran berbeda (Pimpinan ↔ Staf PMB).</p>
            {msg ? <p role="status" className="mb-2 rounded bg-[var(--color-brand-soft)] p-2 text-sm">{msg}</p> : null}
            <label htmlFor="pcode" className="text-sm font-semibold">Kode</label>
            <select id="pcode" className="field mb-2" value={code} onChange={(e) => setCode(e.target.value)}>{active.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}</select>
            <label htmlFor="pval" className="text-sm font-semibold">Nilai baru (JSON)</label>
            <textarea id="pval" className="field mb-2 font-mono text-sm" rows={5} value={value} onChange={(e) => setValue(e.target.value)} />
            <label htmlFor="preason2" className="text-sm font-semibold">Alasan (wajib)</label>
            <textarea id="preason2" className="field mb-2" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={!reason.trim()} onClick={() => void run(async () => { let v: unknown; try { v = JSON.parse(value); } catch { throw new Error("Nilai bukan JSON yang valid"); } await api("/api/params/proposals", { body: { code, value: v, reason } }); setReason(""); }, "Usulan tercatat; menunggu persetujuan.")}>Kirim usulan</button>
          </section>
          <section className="card p-4" aria-labelledby="pend-h">
            <h2 id="pend-h" className="mb-2 text-base font-bold">Menunggu persetujuan ({pending.length})</h2>
            <ul className="flex flex-col gap-2">
              {pending.map((p) => {
                const own = p.proposedBy === user?.id;
                const sameRole = p.proposedRole === user?.role;
                return (
                  <li key={p.id} className="rounded-lg border border-[var(--color-line)] p-3 text-sm">
                    <div className="font-semibold">{p.code} v{p.version} → <code>{JSON.stringify(p.value)}</code></div>
                    <div className="text-xs text-[var(--color-muted)]">Diusulkan {ROLE_LABEL[p.proposedRole] ?? p.proposedRole} · {time(p.createdAt)} · “{p.reason}”</div>
                    <button type="button" className="btn btn-primary mt-2" disabled={own || sameRole} onClick={() => void run(() => api(`/api/params/proposals/${p.id}/approve`, { body: {} }), "Parameter diperbarui.")}>Setujui</button>
                    {own || sameRole ? <p className="mt-1 text-xs text-[var(--color-muted)]">Harus disetujui {p.proposedRole === "staff" ? "Pimpinan" : "Staf PMB"} lain.</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="card p-4 text-sm text-[var(--color-muted)]"><h2 className="mb-1 text-base font-bold text-[var(--color-ink)]">Dasbor KPI</h2>Dasbor KPI, laporan berkala, dan ekspor teranonimkan dibangun pada Fase 3. Peristiwa sumbernya sudah dicatat sejak Fase 1.</section>
        </div>
      </div>
    </StaffShell>
  );
}
