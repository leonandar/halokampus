"use client";
import { useState } from "react";
import { api, setCsrf } from "@/lib/api";
import { homeFor } from "@/components/useStaff";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api("/api/auth/login", { body: { email, password, totp: totp || undefined } });
      setCsrf(r.csrfToken);
      const next = new URLSearchParams(window.location.search).get("lanjut");
      window.location.href = next && next.startsWith("/") ? next : homeFor(r.user.role);
    } catch (err: any) {
      if (err.code === "totp_required") setNeedTotp(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <h1 className="mb-1 text-2xl font-bold">haloK@MPUS</h1>
      <p className="mb-6 text-[var(--color-muted)]">Masuk sebagai petugas layanan PMB</p>
      <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
        <label htmlFor="email" className="text-sm font-semibold">Email</label>
        <input id="email" type="email" autoComplete="username" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password" className="text-sm font-semibold">Kata sandi</label>
        <input id="password" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {needTotp ? (
          <>
            <label htmlFor="totp" className="text-sm font-semibold">Kode 2FA</label>
            <input id="totp" inputMode="numeric" autoComplete="one-time-code" className="field" value={totp} onChange={(e) => setTotp(e.target.value)} />
          </>
        ) : null}
        {error ? <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p> : null}
        <button type="submit" className="btn btn-primary mt-2" disabled={busy}>{busy ? "Memproses…" : "Masuk"}</button>
      </form>
      <p className="mt-4 text-xs text-[var(--color-muted)]">Akun pengembangan bertanda DUMMY tersedia setelah <code>pnpm db:seed</code>.</p>
    </main>
  );
}
