"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Lock, Shield } from "@/components/Icons";

/** Persetujuan & hak data pribadi (FR-63/65/69), reachable from every channel via a bearer link. */
export default function DataRights() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [type, setType] = useState("access");
  const [detail, setDetail] = useState("");
  useEffect(() => setToken(new URLSearchParams(window.location.search).get("t")), []);
  const load = useCallback(async () => {
    if (!token) return;
    try {
      setData(await api("/public/data-rights", { bearer: token }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);
  useEffect(() => void load(), [load]);
  async function toggle(purpose: string, value: boolean) {
    await api("/public/data-rights/consents", { bearer: token!, body: { [purpose]: value } });
    setNotice(value ? "Persetujuan diberikan." : "Persetujuan ditarik.");
    await load();
  }
  async function download() {
    const r = await api("/public/data-rights/export", { bearer: token! });
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salinan-data-halokampus.json";
    a.click();
  }
  if (!token) return <main className="mx-auto max-w-2xl p-4"><p>Tautan tidak lengkap. Minta tautan baru melalui kanal percakapan (ketik: data pribadi saya).</p></main>;
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold"><Shield />Data pribadi & persetujuan</h1>
      <p className="mb-4 text-sm text-[var(--color-muted)]">haloK@MPUS — sesuai UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Tautan ini pribadi dan berlaku 24 jam.</p>
      {error ? <p role="alert" className="rounded bg-[var(--color-danger-soft)] p-3 text-[var(--color-danger)]">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 rounded bg-[var(--color-ok-soft)] p-3 text-[var(--color-ok)]">{notice}</p> : null}
      {data ? (
        <div className="flex flex-col gap-4">
          <section className="card p-4" aria-labelledby="cons-h">
            <h2 id="cons-h" className="mb-2 font-bold">Persetujuan per tujuan</h2>
            <ul className="flex flex-col gap-2">
              {Object.entries(data.purposes as Record<string, { label: string; required: boolean }>).map(([k, p]) => (
                <li key={k} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] p-3">
                  <div className="grow"><div className="font-semibold">{p.label}</div><div className="text-xs text-[var(--color-muted)]">{p.required ? "Wajib untuk memakai layanan; menariknya menghentikan layanan helpdesk." : "Opsional; dapat ditarik kapan saja."}</div></div>
                  <span className={`badge ${data.consents[k] ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "bg-slate-100"}`}>{data.consents[k] ? "Disetujui" : "Tidak"}</span>
                  <button type="button" className="btn btn-ghost" onClick={() => void toggle(k, !data.consents[k])}>{data.consents[k] ? "Tarik" : "Setujui"}</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-[var(--color-muted)]">Versi pemberitahuan: {data.noticeVersion}</p>
          </section>
          <section className="card p-4" aria-labelledby="mine-h">
            <h2 id="mine-h" className="mb-2 flex items-center gap-2 font-bold"><Lock />Data yang kami simpan</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[var(--color-muted)]">Nama panggilan</dt><dd>{data.profile.displayName ?? "–"}</dd>
              <dt className="text-[var(--color-muted)]">No. pendaftaran</dt><dd>{data.profile.regNo ?? "–"}</dd>
              <dt className="text-[var(--color-muted)]">Email</dt><dd>{data.profile.email ?? "–"}</dd>
              <dt className="text-[var(--color-muted)]">WhatsApp</dt><dd>{data.profile.phone ?? "–"}</dd>
              <dt className="text-[var(--color-muted)]">Prodi / jalur / tahap</dt><dd>{[data.profile.programCode, data.profile.admissionPath, data.profile.stage].map((x: string | null) => x ?? "–").join(" / ")}</dd>
              <dt className="text-[var(--color-muted)]">Kanal terhubung</dt><dd>{data.channels.join(", ")}</dd>
            </dl>
            <p className="mt-2 text-xs text-[var(--color-muted)]">Kami hanya meminta: {data.allowedData.map((a: any) => a.label).join(", ")}.</p>
            <button type="button" className="btn btn-ghost mt-3" onClick={() => void download()}>Unduh salinan data saya</button>
          </section>
          <section className="card p-4" aria-labelledby="dsr-h">
            <h2 id="dsr-h" className="mb-2 font-bold">Ajukan permintaan hak data</h2>
            <form className="flex flex-col gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await api("/public/data-rights/requests", { bearer: token, body: { type, detail } }); setNotice(`Permintaan tercatat (${r.id.slice(0, 8)}). ${r.dueAt ? `Batas penyelesaian: ${new Date(r.dueAt).toLocaleString("id-ID")}` : "Batas waktu penyelesaian mengikuti kebijakan institusi."}`); setDetail(""); await load(); }}>
              <label htmlFor="dsrtype" className="text-sm font-semibold">Jenis</label>
              <select id="dsrtype" className="field" value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(data.requestTypes as Record<string, string>).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <label htmlFor="dsrdetail" className="text-sm font-semibold">Keterangan (opsional)</label>
              <textarea id="dsrdetail" className="field" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
              <div><button type="submit" className="btn btn-primary">Kirim permintaan</button></div>
            </form>
            {data.requests.length ? <ul className="mt-3 text-sm">{data.requests.map((r: any) => <li key={r.id}>{r.typeLabel} — {r.status}</li>)}</ul> : null}
            <p className="mt-2 text-xs text-[var(--color-muted)]">Koreksi data pendaftaran diteruskan ke sistem PMB; haloK@MPUS tidak mengubah data pendaftar.</p>
          </section>
        </div>
      ) : !error ? <p>Memuat…</p> : null}
    </main>
  );
}
