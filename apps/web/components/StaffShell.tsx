"use client";
import Link from "next/link";
import { api, setCsrf } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";
import type { StaffUser } from "./useStaff";

const NAV: Record<string, Array<[string, string]>> = {
  cp: [["/cp", "Konsol Tingkat 2"], ["/telepon", "Catat panggilan"], ["/survei-petugas", "Survei"]],
  staff: [["/staf", "Konsol Tingkat 3"], ["/telepon", "Catat panggilan"], ["/dasbor", "Dasbor KPI"], ["/parameter", "Parameter"], ["/survei-petugas", "Survei"]],
  leader: [["/dasbor", "Dasbor KPI"], ["/orkestrasi", "Siklus orkestrasi"], ["/parameter", "Parameter kebijakan"], ["/survei-petugas", "Survei"]],
  finance: [["/keuangan", "Tiket pembayaran"], ["/survei-petugas", "Survei"]],
  admin: [["/admin", "Pengguna & kanal"], ["/survei-petugas", "Survei"]],
};

export function StaffShell({ user, title, children, banner }: { user: StaffUser | null; title: string; children: React.ReactNode; banner?: React.ReactNode }) {
  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    setCsrf(null);
    window.location.href = "/masuk";
  }
  return (
    <div className="min-h-dvh">
      <header className="bg-[var(--color-ink)] text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2">
          <Link href="/" className="text-lg font-bold tracking-tight">haloK@MPUS</Link>
          <span className="text-sm text-slate-300">{title}</span>
          <nav aria-label="Navigasi konsol" className="flex flex-wrap gap-1">
            {(user ? NAV[user.role] ?? [] : []).map(([href, label]) => (
              <Link key={href} href={href} className="btn !min-h-[40px] text-white hover:bg-white/10">{label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {user ? <span><span className="font-semibold">{user.name}</span> · {ROLE_LABEL[user.role]}</span> : null}
            <button type="button" className="btn btn-ghost !min-h-[40px]" onClick={logout}>Keluar</button>
          </div>
        </div>
      </header>
      {banner}
      <main className="mx-auto max-w-[1400px] px-4 py-4">{user ? children : <p className="text-[var(--color-muted)]">Memuat…</p>}</main>
    </div>
  );
}
