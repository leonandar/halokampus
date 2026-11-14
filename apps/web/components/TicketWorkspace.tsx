"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { CHANNEL_LABEL, SENDER_LABEL, STATUS_LABEL, pct, time } from "@/lib/format";
import { Countdown } from "./Countdown";
import { ArrowUp, Bot, Check, Eye, Lock, Person, Send } from "./Icons";
import type { StaffUser } from "./useStaff";
import { useStaffSocket } from "./useStaffSocket";

interface QueueItem {
  id: string;
  number: number;
  tier: string;
  status: string;
  category: string;
  categoryLabel: string;
  mandatory: boolean;
  reasonLabel: string | null;
  channel: string;
  customerName: string;
  openedAt: string;
  assignedUserId: string | null;
  assignedName: string | null;
  lastConfidence: number | null;
  sla: { startsAt: string; deadlineAt: string; state: string; paramCode: string } | null;
  isDummy: boolean;
}

export function ChannelBadge({ code }: { code: string }) {
  const color = code === "whatsapp" ? "bg-green-100 text-green-900" : code === "web" ? "bg-sky-100 text-sky-900" : "bg-slate-200 text-slate-900";
  return <span className={`badge ${color}`}>{CHANNEL_LABEL[code] ?? code}</span>;
}

export function TicketWorkspace({ user, tier, mode }: { user: StaffUser; tier: "T2" | "T3" | "all"; mode: "cp" | "staff" | "finance" }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>("");

  const loadQueue = useCallback(async () => {
    const r = await api<{ items: QueueItem[] }>(`/api/queue/${tier.toLowerCase()}${channel ? `?channel=${channel}` : ""}`);
    setItems(r.items);
  }, [tier, channel]);
  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api(`/api/tickets/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => void loadQueue(), [loadQueue]);
  useEffect(() => {
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);
  // Polling fallback in addition to sockets (e.g. when only long-polling is available).
  useEffect(() => {
    const t = setInterval(() => void loadQueue(), 10_000);
    return () => clearInterval(t);
  }, [loadQueue]);
  useStaffSocket(["queue.update", "ticket.message", "ticket.update", "ticket.message.status"], (event, p: any) => {
    void loadQueue();
    if (selected && p?.ticketId === selected) void loadDetail(selected);
  });

  const mine = useMemo(() => items.filter((i) => i.assignedUserId === user.id), [items, user.id]);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await loadQueue();
      if (selected) await loadDetail(selected);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <section aria-labelledby="antrean-h" className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="antrean-h" className="text-base font-bold">{tier === "all" ? "Kotak masuk terpadu" : `Antrean Tingkat ${tier.slice(1)}`} <span className="text-[var(--color-muted)]">({items.length})</span></h2>
          {mine.length ? <span className="badge bg-[var(--color-brand-soft)] text-[var(--color-brand)]">{mine.length} milik Anda</span> : null}
        </div>
        <label htmlFor={`chan-${tier}`} className="sr-only">Saring kanal</label>
        <select id={`chan-${tier}`} className="field mb-2" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Semua kanal</option>
          {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {items.length === 0 ? <p className="py-6 text-center text-sm text-[var(--color-muted)]">Tidak ada tiket di antrean.</p> : null}
        <ul className="flex flex-col gap-2">
          {items.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setSelected(t.id)} aria-current={selected === t.id} className={`w-full rounded-lg border p-3 text-left ${selected === t.id ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]" : "border-[var(--color-line)] bg-white hover:bg-slate-50"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">#{t.number}</span>
                  <ChannelBadge code={t.channel} />
                  <span className={`badge ${t.mandatory ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-slate-100 text-slate-800"}`}>{t.categoryLabel}</span>
                  {t.sla ? <span className="ml-auto"><Countdown deadlineAt={t.sla.deadlineAt} startsAt={t.sla.startsAt} state={t.sla.state} /></span> : null}
                </div>
                <div className="mt-1 text-sm">{t.customerName}{t.isDummy ? <span className="ml-1 text-xs text-[var(--color-muted)]">(DUMMY)</span> : null}</div>
                <div className="mt-0.5 text-xs text-[var(--color-muted)]">{tier === "all" ? `Tingkat ${t.tier.slice(1)} · ` : ""}{STATUS_LABEL[t.status]}{t.assignedName ? ` · ${t.assignedName}` : ""}{t.reasonLabel ? ` · ${t.reasonLabel}` : ""}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Detail tiket" className="min-w-0">
        {error ? <div role="alert" className="mb-3 rounded-lg bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">{error}</div> : null}
        {notice ? <div role="status" className="mb-3 rounded-lg bg-[var(--color-ok-soft)] p-3 text-sm text-[var(--color-ok)]">{notice}</div> : null}
        {!detail ? (
          <div className="card p-8 text-center text-[var(--color-muted)]">Pilih tiket dari antrean.</div>
        ) : (
          <TicketDetail detail={detail} user={user} mode={mode} act={act} onReload={() => selected && loadDetail(selected)} />
        )}
      </section>
    </div>
  );
}

function TicketDetail({ detail, user, mode, act, onReload }: { detail: any; user: StaffUser; mode: "cp" | "staff" | "finance"; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; onReload: () => void }) {
  const t = detail.ticket;
  const h = detail.handoff;
  const mineNow = t.assignedUserId === user.id;
  const waiting = t.status.endsWith("WAITING");
  const canWork = mode !== "finance";
  const [reply, setReply] = useState("");
  const [draftInfo, setDraftInfo] = useState<{ text: string; sources: any[] } | null>(null);
  const [template, setTemplate] = useState<string>("");
  const [templates, setTemplates] = useState<Array<{ code: string; title: string; body: string }>>([]);
  const [escalateReason, setEscalateReason] = useState("");
  const [showEscalate, setShowEscalate] = useState(false);
  const [unmasked, setUnmasked] = useState<any>(null);
  const [replyChannel, setReplyChannel] = useState<string>("");

  useEffect(() => {
    setReply("");
    setDraftInfo(null);
    setUnmasked(null);
    setShowEscalate(false);
    setReplyChannel("");
  }, [t.id]);
  useEffect(() => {
    if (canWork) void api("/api/templates").then((r) => setTemplates(r.templates)).catch(() => undefined);
  }, [canWork]);

  async function loadDraft() {
    const d = await api(`/api/tickets/${t.id}/draft`);
    setDraftInfo({ text: d.draft, sources: d.sources });
    setReply(d.draft);
  }
  const draftUsage = draftInfo ? (reply.trim() === draftInfo.text.trim() ? "as_is" : "edited") : "none";
  const timer = detail.sla.filter((s: any) => s.tier === t.tier).at(-1);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold">Tiket #{t.number}</h2>
          <span className="badge bg-slate-100 text-slate-800">{STATUS_LABEL[t.status]}</span>
          <span className={`badge ${t.mandatory ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-slate-100 text-slate-800"}`}>{t.categoryLabel}{t.mandatory ? " · kategori wajib T3" : ""}</span>
          {timer ? <Countdown deadlineAt={timer.deadlineAt} startsAt={timer.startsAt} state={timer.state} /> : null}
          {t.isDummy ? <span className="badge bg-[var(--color-warn-soft)] text-[var(--color-warn)]">DUMMY</span> : null}
          <div className="ml-auto flex flex-wrap gap-2">
            {canWork && waiting ? <button type="button" className="btn btn-primary" onClick={() => act(() => api(`/api/tickets/${t.id}/claim`, { method: "POST", body: {} }), "Tiket diklaim.")}>Klaim tiket</button> : null}
            {canWork && mineNow ? <button type="button" className="btn btn-ghost" onClick={() => act(() => api(`/api/tickets/${t.id}/resolve`, { method: "POST", body: {} }), "Tiket ditandai selesai.")}><Check />Tandai selesai</button> : null}
            {mode === "cp" && mineNow ? <button type="button" className="btn btn-warn" onClick={() => setShowEscalate((v) => !v)} aria-expanded={showEscalate}><ArrowUp />Eskalasi ke Staf PMB</button> : null}
          </div>
        </div>
        {showEscalate ? (
          <form className="mt-3 flex flex-col gap-2 rounded-lg bg-[var(--color-warn-soft)] p-3" onSubmit={(e) => { e.preventDefault(); void act(() => api(`/api/tickets/${t.id}/escalate`, { body: { reason: escalateReason } }), "Tiket diteruskan ke Staf PMB."); }}>
            <label htmlFor="esc-reason" className="text-sm font-semibold">Alasan eskalasi (wajib)</label>
            <textarea id="esc-reason" className="field" rows={2} value={escalateReason} onChange={(e) => setEscalateReason(e.target.value)} required />
            <div><button type="submit" className="btn btn-warn" disabled={!escalateReason.trim()}>Kirim eskalasi</button></div>
          </form>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-4" aria-labelledby="handoff-h">
          <h3 id="handoff-h" className="mb-2 font-bold">Serah-terima</h3>
          {h ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[var(--color-muted)]">Ringkasan AI</dt><dd>{h.summary}</dd>
              <dt className="text-[var(--color-muted)]">Alasan</dt><dd>{h.reasonLabel}{h.note ? ` — “${h.note}”` : ""}</dd>
              <dt className="text-[var(--color-muted)]">Keyakinan AI</dt>
              <dd>{h.confidence !== null && h.confidence !== undefined ? <>{pct(h.confidence)} {h.confidenceComponents ? <span className="text-[var(--color-muted)]">(retrieval {pct(h.confidenceComponents.retrieval)}, niat {pct(h.confidenceComponents.intent)}, penilaian diri {pct(h.confidenceComponents.self)})</span> : null}</> : "–"}</dd>
              <dt className="text-[var(--color-muted)]">Kanal</dt><dd className="flex flex-wrap gap-1">{h.channels.map((c: any) => <span key={c.channel}><ChannelBadge code={c.channel} /> <span className="text-xs">{c.messages} pesan</span></span>)}</dd>
            </dl>
          ) : <p className="text-sm text-[var(--color-muted)]">Belum ada eskalasi.</p>}
        </section>
        <section className="card p-4" aria-labelledby="cust-h">
          <div className="mb-2 flex items-center gap-2">
            <h3 id="cust-h" className="font-bold">Calon mahasiswa</h3>
            <span className="badge bg-slate-100 text-slate-700"><Lock className="h-3.5 w-3.5" />tersamar</span>
            {detail.authority.canUnmask && !unmasked ? (
              <button type="button" className="btn btn-ghost ml-auto !min-h-[44px]" onClick={() => { const reason = window.prompt("Alasan membuka data pribadi (tercatat di audit):"); if (reason) void api(`/api/tickets/${t.id}/unmask`, { body: { reason } }).then(setUnmasked); }}><Eye />Buka data</button>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[var(--color-muted)]">Nama</dt><dd>{unmasked?.displayName ?? detail.customer.displayName ?? "–"}</dd>
            <dt className="text-[var(--color-muted)]">No. pendaftaran</dt><dd>{unmasked?.regNo ?? (detail.customer.regNo || "–")}</dd>
            <dt className="text-[var(--color-muted)]">Telepon</dt><dd>{unmasked?.phone ?? (detail.customer.phone || "–")}</dd>
            <dt className="text-[var(--color-muted)]">Email</dt><dd>{unmasked?.email ?? (detail.customer.email || "–")}</dd>
            <dt className="text-[var(--color-muted)]">Prodi / jalur / tahap</dt><dd>{[detail.customer.programCode, detail.customer.admissionPath, detail.customer.stage].map((x) => x ?? "–").join(" / ")}</dd>
            <dt className="text-[var(--color-muted)]">Terverifikasi</dt><dd>{detail.customer.verified ? "Ya (OTP)" : "Belum"}</dd>
          </dl>
        </section>
      </div>

      <section className="card p-4" aria-labelledby="tl-h">
        <h3 id="tl-h" className="mb-3 font-bold">Linimasa lintas kanal</h3>
        <ol className="flex flex-col gap-3">
          {detail.timeline.map((m: any) => (
            <li key={m.id} className={`flex gap-3 ${m.senderType === "customer" ? "" : "flex-row-reverse text-right"}`}>
              <span className={`mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full ${m.senderType === "ai" ? "bg-[var(--color-ai-soft)] text-[var(--color-ai)]" : m.senderType === "customer" ? "bg-slate-200" : "bg-[var(--color-brand-soft)] text-[var(--color-brand)]"}`}>{m.senderType === "ai" ? <Bot /> : <Person />}</span>
              <div className={`max-w-[80%] rounded-lg border p-2 text-sm ${m.retracted ? "border-dashed border-[var(--color-danger)] bg-[var(--color-danger-soft)]" : "border-[var(--color-line)] bg-white"}`}>
                <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-[var(--color-muted)]">
                  <span className="font-semibold text-[var(--color-ink)]">{SENDER_LABEL[m.senderType] ?? m.senderType}</span><ChannelBadge code={m.channel} /><span>{time(m.createdAt)}</span>
                  {m.senderType !== "customer" && m.channel !== "web" && m.channel !== "phone" ? <span>· {({ sent: "terkirim", delivered: "diterima", read: "dibaca", failed: "gagal terkirim" } as Record<string, string>)[m.deliveryStatus] ?? m.deliveryStatus}</span> : null}
                </div>
                <p className="whitespace-pre-wrap text-left">{m.text}</p>
                {m.meta?.citations?.length ? <p className="mt-1 text-left text-xs text-[var(--color-muted)]">Sumber: {m.meta.citations.map((c: any) => `${c.title} — ${c.section}`).join("; ")}</p> : null}
                {m.meta?.promise ? <p className="mt-1 text-left text-xs text-[var(--color-brand)]">{m.meta.promise}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {canWork && mineNow ? (
        <section className="card p-4" aria-labelledby="reply-h">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 id="reply-h" className="font-bold">Balas</h3>
            <button type="button" className="btn btn-ghost" onClick={() => void loadDraft()}><Bot />Minta draf AI</button>
            <label className="sr-only" htmlFor="tpl">Templat pesan</label>
            <select id="tpl" className="field !w-auto" value={template} onChange={(e) => { setTemplate(e.target.value); const tp = templates.find((x) => x.code === e.target.value); if (tp) setReply((r) => (r ? `${r}\n${tp.body}` : tp.body)); }}>
              <option value="">Sisipkan templat…</option>
              {templates.map((tp) => <option key={tp.code} value={tp.code}>{tp.code} · {tp.title}</option>)}
            </select>
            {detail.replyChannels?.length > 1 ? (
              <>
                <label className="sr-only" htmlFor="rchan">Kirim lewat kanal</label>
                <select id="rchan" className="field !w-auto" value={replyChannel} onChange={(e) => setReplyChannel(e.target.value)}>
                  <option value="">Kanal terakhir ({CHANNEL_LABEL[t.channel] ?? t.channel})</option>
                  {detail.replyChannels.map((c: string) => <option key={c} value={c}>Kirim lewat {CHANNEL_LABEL[c] ?? c}</option>)}
                </select>
              </>
            ) : null}
          </div>
          {draftInfo ? <p className="mb-2 rounded bg-[var(--color-ai-soft)] p-2 text-xs text-[var(--color-ai)]">Draf AI — periksa dan sunting sebelum dikirim. Sumber: {draftInfo.sources.map((s) => `${s.title} — ${s.section}`).join("; ") || "–"}</p> : null}
          <label htmlFor="reply" className="sr-only">Isi balasan</label>
          <textarea id="reply" className="field" rows={5} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Tulis balasan untuk calon mahasiswa…" />
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" disabled={!reply.trim()} onClick={() => act(async () => { await api(`/api/tickets/${t.id}/reply`, { body: { text: reply, draftUsage, template: template || null, channel: replyChannel || null } }); setReply(""); setDraftInfo(null); setTemplate(""); }, "Balasan terkirim.")}><Send />Kirim</button>
          </div>
        </section>
      ) : null}
      <button type="button" className="sr-only" onClick={onReload}>Muat ulang</button>
    </div>
  );
}
