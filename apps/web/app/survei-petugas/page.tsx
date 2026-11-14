"use client";
import { useCallback, useEffect, useState } from "react";
import { StaffShell } from "@/components/StaffShell";
import { useStaff } from "@/components/useStaff";
import { api, ApiError } from "@/lib/api";

/** Usability survey for staff roles (FR-58). Items are loaded from config/surveys; none are written here. */
export default function StaffSurvey() {
  const { user } = useStaff(["cp", "staff", "leader", "finance", "admin"]);
  const [items, setItems] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, number>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setItems((await api("/api/usability")).items), []);
  useEffect(() => void (user && load()), [user, load]);
  return (
    <StaffShell user={user} title="Survei usability">
      {msg ? <p role="status" className="mb-3 rounded bg-[var(--color-brand-soft)] p-2 text-sm">{msg}</p> : null}
      {items.map((s) => (
        <form key={s.code} className="card mb-4 flex flex-col gap-3 p-4" onSubmit={async (e) => { e.preventDefault(); try { await api(`/api/usability/${s.code}`, { body: { answers: answers[s.code] ?? {} } }); setMsg("Terima kasih, jawaban tersimpan."); await load(); } catch (err) { setMsg(err instanceof ApiError ? err.message : String(err)); } }}>
          <h2 className="text-base font-bold">{s.title}</h2>
          {s.dummy ? <p className="rounded bg-[var(--color-warn-soft)] p-2 text-xs text-[var(--color-warn)]">Butir masih DUMMY; butir resmi disediakan tim instrumen penelitian.</p> : null}
          {s.answered ? <p className="text-sm text-[var(--color-ok)]">Anda sudah mengisi survei ini.</p> : s.items.map((it: any) => (
            <fieldset key={it.id}>
              <legend className="mb-1 text-sm font-semibold">{it.text}</legend>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: it.scale.max - it.scale.min + 1 }, (_, i) => it.scale.min + i).map((v) => (
                  <label key={v} className="btn btn-ghost has-[:checked]:border-[var(--color-brand)] has-[:checked]:bg-[var(--color-brand-soft)]"><input type="radio" className="h-4 w-4" name={`${s.code}-${it.id}`} required onChange={() => setAnswers({ ...answers, [s.code]: { ...(answers[s.code] ?? {}), [it.id]: v } })} />{v}</label>
                ))}
              </div>
              {it.scale.minLabel ? <p className="mt-1 text-xs text-[var(--color-muted)]">{it.scale.min} = {it.scale.minLabel} · {it.scale.max} = {it.scale.maxLabel}</p> : null}
            </fieldset>
          ))}
          {!s.answered ? <div><button type="submit" className="btn btn-primary">Kirim</button></div> : null}
        </form>
      ))}
    </StaffShell>
  );
}
