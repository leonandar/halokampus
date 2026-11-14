"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Send } from "@/components/Icons";

type Ch = "whatsapp" | "instagram" | "messenger" | "telegram" | "email";
const THEME: Record<Ch, { title: string; head: string; mine: string; theirs: string; canvas: string; idLabel: string; idDefault: string; btn: string }> = {
  whatsapp: { title: "WhatsApp", head: "#075e54", mine: "#d9fdd3", theirs: "#ffffff", canvas: "#e7ded4", idLabel: "Nomor pengirim", idDefault: "6281200000009", btn: "#008069" },
  instagram: { title: "Instagram DM", head: "#c13584", mine: "#efe1f7", theirs: "#ffffff", canvas: "#fafafa", idLabel: "ID pengguna Instagram (IGSID)", idDefault: "ig-17841400000009", btn: "#a3236b" },
  messenger: { title: "Facebook Messenger", head: "#0866ff", mine: "#dbe7ff", theirs: "#ffffff", canvas: "#f0f2f5", idLabel: "PSID", idDefault: "psid-5551000009", btn: "#0757d4" },
  telegram: { title: "Telegram", head: "#2a7fb6", mine: "#e1f7d1", theirs: "#ffffff", canvas: "#dbe6ee", idLabel: "Chat ID", idDefault: "700000009", btn: "#1f6c9e" },
  email: { title: "Email", head: "#334155", mine: "#e2e8f0", theirs: "#ffffff", canvas: "#f8fafc", idLabel: "Alamat email pengirim", idDefault: "calon.dummy@contoh.invalid", btn: "#334155" },
};

interface Bubble { id: string; from: "me" | "biz"; text: string; buttons: Array<{ id: string; title: string }>; at: string; pid?: string }

function read(ch: Ch, id: string, at: string, p: any): Bubble {
  const pid = p._meta?.providerMessageId;
  if (ch === "whatsapp") return p.type === "interactive" ? { id, at, pid, from: "biz", text: p.interactive.body.text, buttons: p.interactive.action.buttons.map((b: any) => b.reply) } : { id, at, pid, from: "biz", text: p.text.body, buttons: [] };
  if (ch === "instagram" || ch === "messenger") return { id, at, pid, from: "biz", text: p.message.text, buttons: (p.message.quick_replies ?? []).map((q: any) => ({ id: q.payload, title: q.title })) };
  if (ch === "telegram") return { id, at, pid, from: "biz", text: p.text, buttons: (p.reply_markup?.inline_keyboard ?? []).flat().map((b: any) => ({ id: b.callback_data, title: b.text })) };
  return { id, at, pid, from: "biz", text: `Subjek: ${p.subject}\n\n${p.text}`, buttons: [] };
}

/** Channel simulators (FR-52): provider-format payloads through the real webhook handlers. */
export default function Simulator({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = use(params);
  const ch = (channel in THEME ? channel : "whatsapp") as Ch;
  const th = THEME[ch];
  const [from, setFrom] = useState(th.idDefault);
  const [name, setName] = useState("Pengguna Simulator");
  const [mine, setMine] = useState<Bubble[]>([]);
  const [theirs, setTheirs] = useState<Bubble[]>([]);
  const [text, setText] = useState("");
  const seen = useRef(new Set<string>());
  const endRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    const r = await api(`/sim/${ch}/outbox?to=${encodeURIComponent(from)}`);
    const bubbles: Bubble[] = r.items.map((i: any) => read(ch, i.id, i.createdAt, i.payload));
    setTheirs(bubbles);
    const unseen = bubbles.map((b) => b.pid).filter((p): p is string => Boolean(p) && !seen.current.has(p!));
    if (unseen.length) {
      unseen.forEach((p) => seen.current.add(p));
      void api(`/sim/${ch}/read`, { body: { providerMessageIds: unseen } }).catch(() => undefined);
    }
  }, [ch, from]);
  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [poll]);
  const all = [...mine, ...theirs].sort((a, b) => a.at.localeCompare(b.at));
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [all.length]);

  async function send(body: { text?: string; buttonId?: string; buttonTitle?: string; attachment?: boolean }) {
    setMine((m) => [...m, { id: `me-${Date.now()}`, from: "me", text: body.attachment ? "[berkas.pdf]" : body.buttonTitle ?? body.text ?? "", buttons: [], at: new Date().toISOString() }]);
    await api(`/sim/${ch}/send`, { body: { from, name, ...body } });
    void poll();
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-3 px-4 py-4">
      <h1 className="text-lg font-bold">Simulator {th.title} <span className="badge bg-[var(--color-warn-soft)] text-[var(--color-warn)]">DUMMY · pengembangan</span></h1>
      <nav aria-label="Simulator lain" className="flex flex-wrap gap-1 text-sm">
        {(Object.keys(THEME) as Ch[]).map((c) => <Link key={c} href={`/sim/${c}`} aria-current={c === ch ? "page" : undefined} className={`btn !min-h-[44px] ${c === ch ? "btn-primary" : "btn-ghost"}`}>{THEME[c].title}</Link>)}
      </nav>
      <div className="flex gap-2">
        <label className="grow text-sm"><span className="font-semibold">{th.idLabel}</span><input className="field mt-1" value={from} onChange={(e) => { setFrom(e.target.value.trim()); setMine([]); seen.current.clear(); }} /></label>
        <label className="w-36 text-sm"><span className="font-semibold">Nama</span><input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <section aria-label={`Percakapan ${th.title}`} className="flex h-[62dvh] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)]" style={{ background: th.canvas }}>
        <div className="px-4 py-3 font-semibold text-white" style={{ background: th.head }}>PMB haloK@MPUS · {th.title}</div>
        <div className="flex grow flex-col gap-2 overflow-y-auto p-3" role="log" aria-live="polite" tabIndex={0} aria-label="Riwayat pesan">
          {all.map((b) => (
            <div key={b.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${b.from === "me" ? "self-end" : "self-start"}`} style={{ background: b.from === "me" ? th.mine : th.theirs }}>
              <p className="whitespace-pre-wrap">{b.text}</p>
              {b.buttons.length ? <div className="mt-2 flex flex-wrap gap-1">{b.buttons.map((btn) => <button key={btn.id} type="button" className="btn btn-ghost !justify-center" style={{ color: th.btn }} onClick={() => void send({ buttonId: btn.id, buttonTitle: btn.title })}>{btn.title}</button>)}</div> : null}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 bg-white/80 p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ text }); setText(""); } }}>
          <button type="button" className="btn btn-ghost" onClick={() => void send({ attachment: true })} aria-label="Kirim lampiran contoh">+</button>
          <label htmlFor="simtext" className="sr-only">Pesan</label>
          <input id="simtext" className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder={ch === "email" ? "Isi email" : "Ketik pesan"} autoComplete="off" />
          <button type="submit" className="btn text-white" style={{ background: th.btn }} aria-label="Kirim"><Send /></button>
        </form>
      </section>
      <p className="text-xs text-[var(--color-muted)]">Tanpa tombol bawaan (mis. email), balas dengan angka/kata pada baris “Balas dengan”. Ketik MANUSIA kapan saja untuk dilayani petugas.</p>
    </main>
  );
}
