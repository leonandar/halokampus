"use client";
import { useState } from "react";
import Link from "next/link";
import { StaffShell } from "@/components/StaffShell";
import { useStaff } from "@/components/useStaff";
import { api, ApiError } from "@/lib/api";

/** Call-centre logging (FR-51): a call becomes the same ticket, timeline and KPI events as any channel. */
export default function PhoneLog() {
  const { user } = useStaff(["cp", "staff"]);
  const [f, setF] = useState({ callerPhone: "", callerName: "", verbalConsent: false, question: "", answer: "", outcome: "resolved", escalateReason: "" });
  const [result, setResult] = useState<{ ticketId: string; tier: string; category: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setResult(await api("/api/phone-calls", { body: f }));
      setF({ ...f, callerPhone: "", callerName: "", verbalConsent: false, question: "", answer: "", escalateReason: "" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }
  return (
    <StaffShell user={user} title="Pencatatan panggilan telepon">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
          <h2 className="text-base font-bold">Catat panggilan</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold">Nomor penelepon<input className="field mt-1" inputMode="tel" value={f.callerPhone} onChange={(e) => setF({ ...f, callerPhone: e.target.value })} required /></label>
            <label className="text-sm font-semibold">Nama panggilan (opsional)<input className="field mt-1" value={f.callerName} onChange={(e) => setF({ ...f, callerName: e.target.value })} /></label>
          </div>
          <fieldset className="rounded-lg border border-[var(--color-line)] p-3">
            <legend className="px-1 text-sm font-semibold">Persetujuan lisan (wajib)</legend>
            <p className="mb-2 text-sm text-[var(--color-muted)]">Bacakan: “Panggilan ini dicatat oleh layanan PMB haloK@MPUS untuk keperluan layanan dan dapat dibantu AI yang diawasi Staf PMB. Apakah Bapak/Ibu setuju?”</p>
            <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.verbalConsent} onChange={(e) => setF({ ...f, verbalConsent: e.target.checked })} />Penelepon menyetujui</label>
          </fieldset>
          <label className="text-sm font-semibold">Pertanyaan penelepon<textarea className="field mt-1" rows={3} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} required /></label>
          <label className="text-sm font-semibold">Jawaban yang diberikan (opsional)<textarea className="field mt-1" rows={3} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} /></label>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Hasil</legend>
            <div className="flex flex-wrap gap-2">
              {[["resolved", "Selesai saat panggilan"], ["open", "Masih ditindaklanjuti"], ...(user?.role === "cp" ? [["escalate", "Teruskan ke Staf PMB"]] : [])].map(([v, l]) => (
                <label key={v} className="btn btn-ghost has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]"><input type="radio" name="outcome" className="h-4 w-4" checked={f.outcome === v} onChange={() => setF({ ...f, outcome: v! })} />{l}</label>
              ))}
            </div>
          </fieldset>
          {f.outcome === "escalate" ? <label className="text-sm font-semibold">Alasan eskalasi<textarea className="field mt-1" rows={2} value={f.escalateReason} onChange={(e) => setF({ ...f, escalateReason: e.target.value })} required /></label> : null}
          {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
          <div><button type="submit" className="btn btn-primary" disabled={!f.verbalConsent}>Simpan catatan</button></div>
        </form>
        <aside className="card p-4 text-sm">
          <h2 className="mb-2 text-base font-bold">Ketentuan</h2>
          <ul className="list-disc space-y-1 pl-5 text-[var(--color-muted)]">
            <li>Kategori wajib (pembayaran, perubahan data, pengecualian, jalur khusus, keluhan berat) otomatis diteruskan ke Staf PMB.</li>
            <li>Tiket “masih ditindaklanjuti” muncul di konsol Anda; draf AI dapat dipakai di sana.</li>
            <li>Jangan mencatat data di luar daftar yang diizinkan (mis. NIK, kata sandi).</li>
          </ul>
          {result ? (
            <p role="status" className="mt-3 rounded bg-[var(--color-ok-soft)] p-3 text-[var(--color-ok)]">
              Tercatat · Tingkat {result.tier.slice(1)} · kategori {result.category}. <Link className="underline" href={user?.role === "staff" ? "/staf" : "/cp"}>Buka konsol</Link>
            </p>
          ) : null}
        </aside>
      </div>
    </StaffShell>
  );
}
