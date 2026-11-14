"use client";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { useStaff } from "@/components/useStaff";
import { ColumnChart, HBarChart, LineChart } from "@/components/Charts";
import { Check, Doc } from "@/components/Icons";
import { api } from "@/lib/api";
import { CHANNEL_LABEL } from "@/lib/format";

interface Kpi {
  id: string;
  label: string;
  group: string;
  unit: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  n: number;
  status: "ok" | "no_data" | "needs_param";
  note?: string;
  target: number | null;
  better: "higher" | "lower";
  breakdown?: Record<string, number | null>;
}

const GROUPS: Array<[string, string]> = [["kecepatan", "Kecepatan"], ["efektivitas", "Efektivitas"], ["kualitas", "Kualitas & pengalaman"], ["tata_kelola_ai", "Tata kelola AI"], ["beban_kerja", "Beban kerja"], ["pdp", "UU PDP"]];
const CAUSES: Record<string, string> = { factual_error: "Kesalahan fakta", outdated_kb: "Basis pengetahuan usang", wrong_scope: "Tidak sesuai prodi/jalur", tone: "Nada/empati", policy_violation: "Melanggar kebijakan", incomplete: "Tidak lengkap", other: "Lainnya" };

function fmt(k: Kpi): { value: string; unit: string } {
  if (k.value === null) return { value: "–", unit: "" };
  if (k.unit === "seconds") return k.value >= 3600 ? { value: (k.value / 3600).toFixed(1), unit: "jam" } : k.value >= 120 ? { value: (k.value / 60).toFixed(1), unit: "menit" } : { value: String(k.value), unit: "detik" };
  if (k.unit === "milliseconds") return { value: String(Math.round(k.value)), unit: "ms" };
  if (k.unit === "percent") return { value: String(k.value), unit: "%" };
  return { value: String(k.value), unit: k.unit === "score" ? "skor" : "" };
}

function Tile({ k, code }: { k: Kpi; code: string | null }) {
  const f = fmt(k);
  const meets = k.target !== null && k.value !== null ? (k.better === "higher" ? k.value >= k.target : k.value <= k.target) : null;
  return (
    <div className="card flex flex-col gap-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight">{k.label}</h3>
        {code ? <span className="badge bg-slate-100 text-slate-700">{code}</span> : null}
      </div>
      <p className="text-3xl font-bold leading-none">{f.value}<span className="ml-1 text-base font-semibold text-[var(--color-muted)]">{f.unit}</span></p>
      <p className="tabular text-xs text-[var(--color-muted)]">{k.numerator !== undefined && k.denominator ? `${k.numerator} dari ${k.denominator}` : `n = ${k.n}`}{k.breakdown?.median !== undefined && k.breakdown.median !== null ? ` · median ${k.breakdown.median}` : ""}{k.breakdown?.top2Percent !== undefined && k.breakdown.top2Percent !== null ? ` · top-2 ${k.breakdown.top2Percent}%` : ""}</p>
      {k.status === "needs_param" ? <p className="text-xs font-semibold text-[var(--color-warn)]">Butuh parameter — {k.note}</p> : null}
      {k.status === "no_data" ? <p className="text-xs text-[var(--color-muted)]">Belum ada data pada periode ini</p> : null}
      <p className="text-xs">
        {k.target === null ? <span className="text-[var(--color-muted)]">Target belum ditetapkan</span> : meets === null ? <span className="text-[var(--color-muted)]">Target {k.target}</span> : meets ? (
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-good)]"><Check className="h-3.5 w-3.5" />Memenuhi target {k.target}</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--status-serious)]"><span aria-hidden="true">!</span>Belum memenuhi target {k.target}</span>
        )}
      </p>
      {k.note && k.status === "ok" ? <p className="text-[11px] leading-snug text-[var(--color-muted)]">{k.note}</p> : null}
    </div>
  );
}

const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() + 7 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);

export default function Dashboard() {
  const { user } = useStaff(["leader", "staff"]);
  const [f, setF] = useState({ from: daysAgo(6), to: today(), channel: "", category: "", tier: "", includeDummy: true });
  const [r, setR] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = new URLSearchParams({ from: f.from, to: f.to, ...(f.channel ? { channel: f.channel } : {}), ...(f.category ? { category: f.category } : {}), ...(f.tier ? { tier: f.tier } : {}), includeDummy: String(f.includeDummy) }).toString();
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setR(await api(`/api/kpi?${query}`));
      setReports((await api("/api/reports")).items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [query]);
  useEffect(() => void (user && load()), [user, load]);
  async function makeReport(format: "pdf" | "xlsx") {
    const x = await api("/api/reports", { body: { from: f.from, to: f.to, format, includeDummy: f.includeDummy } });
    window.location.href = `/api/reports/${x.id}/download`;
    setReports((await api("/api/reports")).items);
  }
  const k = (id: string): Kpi | undefined => r?.kpis.find((x: Kpi) => x.id === id);

  return (
    <StaffShell user={user} title="Dasbor KPI">
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3" onSubmit={(e) => { e.preventDefault(); void load(); }} aria-label="Saring KPI">
        <label className="text-sm font-semibold">Dari<input type="date" className="field mt-1" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="text-sm font-semibold">Sampai<input type="date" className="field mt-1" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="text-sm font-semibold">Kanal<select className="field mt-1" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="">Semua</option>{Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-sm font-semibold">Kategori<select className="field mt-1" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Semua</option>{["info_umum", "jadwal", "biaya", "persyaratan", "status", "teknis", "pembayaran", "perubahan_data", "pengecualian", "jalur_khusus", "keluhan_berat", "lainnya"].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="text-sm font-semibold">Tingkat<select className="field mt-1" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })}><option value="">Semua</option><option value="T1">T1 (AI)</option><option value="T2">T2 (CP)</option><option value="T3">T3 (Staf)</option></select></label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.includeDummy} onChange={(e) => setF({ ...f, includeDummy: e.target.checked })} />Sertakan data DUMMY</label>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Memuat…" : "Terapkan"}</button>
      </form>
      {error ? <p role="alert" className="mb-3 rounded bg-[var(--color-danger-soft)] p-3 text-[var(--color-danger)]">{error}</p> : null}
      {r?.containsDummy ? <p role="note" className="mb-3 rounded bg-[var(--color-warn-soft)] p-3 text-sm font-semibold text-[var(--color-warn)]">Periode ini memuat data DUMMY (pengembangan). Angka bukan data penelitian. Ekspor penelitian mengecualikan DUMMY secara bawaan.</p> : null}

      {r ? (
        <>
          <section aria-labelledby="hero-h" className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="card p-4">
              <h2 id="hero-h" className="text-sm font-semibold text-[var(--color-muted)]">AI Containment Rate</h2>
              <p className="text-5xl font-bold">{k("containment")?.value ?? "–"}<span className="text-2xl">%</span></p>
              <p className="tabular text-sm text-[var(--color-muted)]">{k("containment")?.numerator ?? 0} dari {r.ticketCount} tiket diselesaikan AI tanpa eskalasi</p>
            </div>
            <div className="card p-4">
              <h2 className="mb-1 text-base font-bold">Corong eskalasi tiga tingkat</h2>
              <HBarChart title="Corong eskalasi" ordinal data={r.funnel.map((s: any) => ({ label: s.label, value: s.count }))} />
            </div>
          </section>

          {GROUPS.map(([g, label]) => {
            const ks = r.kpis.filter((x: Kpi) => x.group === g);
            if (!ks.length) return null;
            return (
              <section key={g} aria-labelledby={`g-${g}`} className="mb-4">
                <h2 id={`g-${g}`} className="mb-2 text-base font-bold">{label}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{ks.map((x: Kpi) => <Tile key={x.id} k={x} code={r.kpiMap[x.id] ?? null} />)}</div>
              </section>
            );
          })}

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <section className="card p-4" aria-labelledby="sla-h">
              <h2 id="sla-h" className="mb-1 text-base font-bold">Kepatuhan SLA per kanal</h2>
              {r.slByChannel.length ? <HBarChart title="Kepatuhan SLA per kanal dan tingkat" max={100} unit="%" data={r.slByChannel.map((s: any) => ({ label: `${CHANNEL_LABEL[s.channel] ?? s.channel} · ${s.tier}`, value: s.value, display: s.value === null ? "–" : `${s.value}% (${s.met}/${s.met + s.breached})` }))} /> : <p className="text-sm text-[var(--color-muted)]">Belum ada SLA yang selesai pada periode ini.</p>}
            </section>
            <section className="card p-4" aria-labelledby="trend-h">
              <h2 id="trend-h" className="mb-1 text-base font-bold">Tren harian</h2>
              <LineChart title="Tiket dibuka dan dieskalasi per hari" labels={r.series.map((s: any) => s.date)} series={[{ name: "Dibuka", color: "var(--series-1)", values: r.series.map((s: any) => s.opened) }, { name: "Dieskalasi", color: "var(--series-2)", values: r.series.map((s: any) => s.escalated) }]} />
            </section>
          </div>

          <section aria-labelledby="gov-h" className="card mb-4 p-4">
            <h2 id="gov-h" className="mb-3 text-base font-bold">Panel tata kelola AI</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Distribusi skor keyakinan (garis = PRM-01 {r.params.PRM01})</h3>
                <ColumnChart title="Distribusi skor keyakinan AI" data={r.confidenceHistogram.map((b: any) => ({ label: b.bin.split("–")[0], value: b.count }))} refLine={{ at: r.params.PRM01, label: "PRM-01" }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Penyebab override</h3>
                {Object.keys(r.overrideCauses).length ? <HBarChart title="Penyebab override" data={Object.entries(r.overrideCauses).map(([c, n]) => ({ label: CAUSES[c] ?? c, value: n as number }))} /> : <p className="text-sm text-[var(--color-muted)]">Belum ada override pada periode ini.</p>}
              </div>
            </div>
          </section>

          <div className="mb-4 grid gap-4 xl:grid-cols-3">
            <section className="card p-4" aria-labelledby="vol-h">
              <h2 id="vol-h" className="mb-1 text-base font-bold">Volume pesan per jam (WIB)</h2>
              <ColumnChart title="Pesan masuk per jam" data={r.volume.byHour.map((v: number, h: number) => ({ label: String(h).padStart(2, "0"), value: v }))} />
            </section>
            <section className="card p-4" aria-labelledby="bl-h">
              <h2 id="bl-h" className="mb-2 text-base font-bold">Backlog & usia tiket</h2>
              <table className="tabular w-full text-left text-sm"><thead className="text-xs text-[var(--color-muted)]"><tr><th className="py-1">Tingkat</th><th>Terbuka</th><th>Rerata usia</th><th>Tertua</th></tr></thead>
                <tbody>{r.backlog.map((b: any) => <tr key={b.tier} className="border-t border-[var(--color-line)]"><td className="py-1">{b.tier}</td><td>{b.open}</td><td>{b.meanAgeHours ?? "–"} jam</td><td>{b.maxAgeHours ?? "–"} jam</td></tr>)}</tbody></table>
            </section>
            <section className="card p-4" aria-labelledby="occ-h">
              <h2 id="occ-h" className="mb-2 text-base font-bold">Occupancy petugas</h2>
              <table className="tabular w-full text-left text-sm"><thead className="text-xs text-[var(--color-muted)]"><tr><th className="py-1">Petugas</th><th>Online</th><th>Menangani</th><th>%</th></tr></thead>
                <tbody>{r.occupancy.map((o: any) => <tr key={o.agentId} className="border-t border-[var(--color-line)]"><td className="py-1">{r.agents[o.agentId] ?? "–"}</td><td>{o.onlineMinutes} mnt</td><td>{o.handlingMinutes} mnt</td><td>{o.value ?? "–"}</td></tr>)}</tbody></table>
            </section>
          </div>

          <section className="card mb-4 p-4" aria-labelledby="exp-h">
            <h2 id="exp-h" className="mb-2 flex items-center gap-2 text-base font-bold"><Doc />Laporan & ekspor</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={() => void makeReport("pdf")}>Laporan PDF</button>
              <button type="button" className="btn btn-ghost" onClick={() => void makeReport("xlsx")}>Laporan XLSX</button>
              <a className="btn btn-ghost" href={`/api/exports/research?from=${f.from}&to=${f.to}&format=csv`}>Ekspor penelitian (CSV)</a>
              <a className="btn btn-ghost" href={`/api/exports/research?from=${f.from}&to=${f.to}&format=xlsx`}>Ekspor penelitian (XLSX)</a>
            </div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">Ekspor penelitian teranonimkan: pseudonim stabil, tanpa nama/kontak/isi pesan, tanpa data DUMMY, hanya pelanggan yang menyetujui “perbaikan layanan”. Setiap ekspor tercatat di jejak audit.</p>
            {reports.length ? (
              <ul className="mt-3 text-sm">{reports.slice(0, 8).map((x) => <li key={x.id}><a className="text-[var(--color-brand)] underline" href={`/api/reports/${x.id}/download`}>{x.filename}</a>{x.includesDummy ? " · DUMMY" : ""}</li>)}</ul>
            ) : null}
          </section>
          <p className="text-xs text-[var(--color-muted)]">Semua angka dihitung dari tabel peristiwa (events); rumus: docs/KPI.md. Dibuat {new Date(r.generatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB.</p>
        </>
      ) : null}
    </StaffShell>
  );
}
