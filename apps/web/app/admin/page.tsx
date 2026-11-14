"use client";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { useStaff } from "@/components/useStaff";
import { api } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/format";

/** Admin TI: users and roles only — no access to conversations (FR-42). */
export default function Admin() {
  const { user } = useStaff(["admin"]);
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "cp", password: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const load = useCallback(async () => {
    setItems((await api("/api/admin/users")).items);
    setChannels((await api("/api/admin/channels")).items);
  }, []);
  useEffect(() => void (user && load()), [user, load]);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/admin/users", { body: form });
      setMsg("Pengguna dibuat.");
      setForm({ email: "", name: "", role: "cp", password: "" });
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }
  return (
    <StaffShell user={user} title="Admin TI · pengguna & peran">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card overflow-x-auto p-4">
          <h2 className="mb-2 text-base font-bold">Pengguna</h2>
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase text-[var(--color-muted)]"><tr><th className="p-2">Nama</th><th className="p-2">Email</th><th className="p-2">Peran</th><th className="p-2">2FA</th><th className="p-2">Status</th></tr></thead>
            <tbody>{items.map((u) => (
              <tr key={u.id} className="border-t border-[var(--color-line)]">
                <td className="p-2">{u.name}</td><td className="p-2">{u.email}</td><td className="p-2">{ROLE_LABEL[u.roleCode]}</td><td className="p-2">{u.totpEnabled ? "Aktif" : "–"}</td>
                <td className="p-2"><button type="button" className="btn btn-ghost" onClick={() => void api(`/api/admin/users/${u.id}/active`, { body: { active: !u.active } }).then(load)}>{u.active ? "Nonaktifkan" : "Aktifkan"}</button></td>
              </tr>))}
            </tbody>
          </table>
        </section>
        <form onSubmit={create} className="card flex flex-col gap-2 p-4">
          <h2 className="text-base font-bold">Tambah pengguna</h2>
          {msg ? <p role="status" className="text-sm">{msg}</p> : null}
          <label htmlFor="ue" className="text-sm font-semibold">Email</label><input id="ue" className="field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <label htmlFor="un" className="text-sm font-semibold">Nama</label><input id="un" className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <label htmlFor="ur" className="text-sm font-semibold">Peran</label>
          <select id="ur" className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label htmlFor="up" className="text-sm font-semibold">Kata sandi awal (min. 10)</label><input id="up" className="field" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} />
          <button type="submit" className="btn btn-primary mt-2">Simpan</button>
          <p className="text-xs text-[var(--color-muted)]">Admin TI tidak dapat membaca isi percakapan maupun data pribadi calon mahasiswa.</p>
        </form>
      </div>
      <section className="card mt-4 overflow-x-auto p-4" aria-labelledby="ch-h">
        <h2 id="ch-h" className="mb-1 text-base font-bold">Integrasi kanal</h2>
        <p className="mb-2 text-sm text-[var(--color-muted)]">Kredensial penyedia disimpan di lingkungan server (.env), tidak di basis data. Menonaktifkan kanal membuat pesan masuk dari kanal itu diabaikan.</p>
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-muted)]"><tr><th className="p-2">Kanal</th><th className="p-2">Mode</th><th className="p-2">Kredensial</th><th className="p-2">Webhook diamankan</th><th className="p-2">Status</th></tr></thead>
          <tbody>{channels.map((c) => (
            <tr key={c.code} className="border-t border-[var(--color-line)]">
              <td className="p-2 font-semibold">{c.name}</td>
              <td className="p-2">{c.mode === "simulator" ? <span className="badge bg-[var(--color-warn-soft)] text-[var(--color-warn)]">simulator</span> : c.mode}</td>
              <td className="p-2">{c.configured ? "Lengkap" : <span className="text-[var(--color-danger)]">Belum diisi</span>}</td>
              <td className="p-2">{c.webhookSecured === null ? "–" : c.webhookSecured ? "Ya" : <span className="text-[var(--color-danger)]">Belum</span>}</td>
              <td className="p-2"><button type="button" className={`btn ${c.enabled ? "btn-ghost" : "btn-primary"}`} onClick={() => void api(`/api/admin/channels/${c.code}`, { body: { enabled: !c.enabled } }).then(load)}>{c.enabled ? "Nonaktifkan" : "Aktifkan"}</button></td>
            </tr>))}
          </tbody>
        </table>
      </section>
    </StaffShell>
  );
}
