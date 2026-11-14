"use client";
import { useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { TicketWorkspace } from "@/components/TicketWorkspace";
import { useStaff } from "@/components/useStaff";
import { Shield } from "@/components/Icons";
import { api } from "@/lib/api";

function MyFeedback() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => void api("/api/me/feedback").then((r) => setItems(r.items)).catch(() => undefined), []);
  if (!items.length) return null;
  return (
    <section className="card mt-4 p-4" aria-labelledby="fb-h">
      <h2 id="fb-h" className="mb-2 text-base font-bold">Umpan balik dari Staf PMB</h2>
      <ul className="flex flex-col gap-2 text-sm">{items.map((f) => <li key={f.id} className="rounded border border-[var(--color-line)] p-2">{f.unread ? <span className="badge mr-2 bg-[var(--color-brand-soft)] text-[var(--color-brand)]">baru</span> : null}<strong>{f.from}:</strong> {f.text}</li>)}</ul>
    </section>
  );
}

const PRESENCE: Array<[string, string]> = [["online", "Online"], ["break", "Istirahat"], ["offline", "Offline"]];

export default function CpConsole() {
  const { user, setUser } = useStaff(["cp"]);
  const [busy, setBusy] = useState(false);
  async function setPresence(status: string) {
    setBusy(true);
    try {
      await api("/api/presence", { body: { status } });
      if (user) setUser({ ...user, presence: status });
    } finally {
      setBusy(false);
    }
  }
  const banner = (
    <div role="note" aria-label="Batas kewenangan" className="sticky top-0 z-10 border-b border-amber-300 bg-[var(--color-warn-soft)]">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-2 text-sm text-[var(--color-warn)]">
        <Shield className="h-5 w-5 flex-none" />
        <p className="min-w-0 flex-1 basis-[480px]"><strong>Batas kewenangan Mahasiswa CP (Lapis 2):</strong> menjawab Tingkat 2 dengan bantuan AI, membimbing, dan meneruskan ke Staf PMB. <strong>Tidak dapat</strong> meng-override/menjeda AI, mengubah data pendaftar, atau mengubah parameter.</p>
        <fieldset className="ml-auto flex items-center gap-1">
          <legend className="sr-only">Status kehadiran</legend>
          {PRESENCE.map(([v, label]) => (
            <button key={v} type="button" disabled={busy} aria-pressed={user?.presence === v} onClick={() => void setPresence(v)} className={`btn !min-h-[44px] ${user?.presence === v ? "btn-primary" : "btn-ghost"}`}>{label}</button>
          ))}
        </fieldset>
      </div>
    </div>
  );
  return (
    <StaffShell user={user} title="Konsol Mahasiswa CP · Tingkat 2" banner={banner}>
      {user ? <TicketWorkspace user={user} tier="T2" mode="cp" /> : null}
      {user ? <MyFeedback /> : null}
    </StaffShell>
  );
}
