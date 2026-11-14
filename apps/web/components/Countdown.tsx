"use client";
import { useEffect, useState } from "react";
import { Clock } from "./Icons";

/** SLA countdown (FR-21). Shows the opening time when the SLA clock has not started yet (Q4-b). */
export function Countdown({ deadlineAt, startsAt, state }: { deadlineAt: string; startsAt?: string; state?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(deadlineAt).getTime();
  const s = startsAt ? new Date(startsAt).getTime() : 0;
  if (state === "met") return <span className="badge bg-[var(--color-ok-soft)] text-[var(--color-ok)]"><Clock className="h-3.5 w-3.5" />SLA terpenuhi</span>;
  if (s > now) {
    return <span className="badge bg-[var(--color-brand-soft)] text-[var(--color-brand)]" title="Di luar jam layanan"><Clock className="h-3.5 w-3.5" />mulai {new Date(s).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>;
  }
  const left = Math.round((d - now) / 1000);
  const breached = state === "breached" || left < 0;
  const abs = Math.abs(left);
  const text = abs >= 3600 ? `${Math.floor(abs / 3600)} j ${Math.floor((abs % 3600) / 60)} m` : `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  const cls = breached ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : left < 60 ? "bg-[var(--color-warn-soft)] text-[var(--color-warn)]" : "bg-[var(--color-ok-soft)] text-[var(--color-ok)]";
  return <span className={`badge ${cls}`} aria-label={breached ? `SLA terlewati ${text}` : `Sisa waktu SLA ${text}`}><Clock className="h-3.5 w-3.5" />{breached ? `lewat ${text}` : text}</span>;
}
