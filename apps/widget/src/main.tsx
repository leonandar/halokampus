import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { io, type Socket } from "socket.io-client";
import { CSS } from "./styles";

// ---------------------------------------------------------------- config
const script = document.currentScript as HTMLScriptElement | null;
const API = (script?.dataset.api ?? "").replace(/\/$/, "");
const TOKEN_KEY = "halokampus_widget_token";

interface Citation { title: string; section: string; version: number }
interface Button { id: string; title: string }
interface Msg {
  id: string;
  senderType?: string;
  senderLabel?: string;
  kind: string;
  text: string;
  citations?: Citation[];
  buttons?: Button[];
  why?: string | null;
  promise?: string | null;
  aiActionId?: string | null;
  retracted?: boolean;
  createdAt: string;
}
type Consents = { service: boolean; proactive_reminder: boolean; service_improvement: boolean };

function store(k: string, v?: string | null): string | null {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
  return null;
}

async function call<T = any>(path: string, token: string | null, body?: unknown, raw?: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, { method: body !== undefined || raw ? "POST" : "GET", headers, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? `HTTP ${res.status}`), { status: res.status, code: data.error });
  return data as T;
}

// ---------------------------------------------------------------- icons (SVG, no emoji)
const Ico = ({ d, label }: { d: string; label?: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : "true"} role={label ? "img" : undefined}>
    {label ? <title>{label}</title> : null}
    <path d={d} />
  </svg>
);
const UP = "M7 10v11H3V10h4zM7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7";
const DOWN = "M17 14V3h4v11h-4zM17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.9 3H17";
const CHAT = "M4 5h16v11H8l-4 4V5z";
const CLOSE = "M6 6l12 12M18 6L6 18";
const SEND = "M4 12l16-8-6 16-2-7-8-1z";
const CLIP = "M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7";
const PERSON = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0";

// ---------------------------------------------------------------- app
function Widget() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(() => store(TOKEN_KEY));
  const [consents, setConsents] = useState<Consents | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, "up" | "down">>({});
  const [showUpload, setShowUpload] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  async function ensureSession() {
    const s = await call<{ token: string; consents: Consents }>("/public/web/session", null, { token: token ?? undefined });
    if (s.token !== token) {
      setToken(s.token);
      store(TOKEN_KEY, s.token);
    }
    setConsents(s.consents);
    return s.token;
  }
  async function refresh(tk = token) {
    if (!tk) return;
    const me = await call<{ messages: Msg[]; consents: Consents }>("/public/me", tk);
    setMessages(me.messages);
    setConsents(me.consents);
  }

  useEffect(() => {
    if (!open) return;
    void ensureSession().then((tk) => refresh(tk)).catch((e) => setError(e.message));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !token) return;
    const s = io(`${API}/customer`, { path: "/socket.io", auth: { token }, transports: ["polling", "websocket"] });
    s.on("message", () => void refresh());
    s.on("message.retracted", () => void refresh());
    socketRef.current = s;
    const poll = setInterval(() => void refresh(), 15000);
    return () => {
      clearInterval(poll);
      s.disconnect();
    };
  }, [open, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, open]);

  async function send(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !token) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((m) => [...m, { id: `local-${Date.now()}`, senderType: "customer", kind: "text", text: t, createdAt: new Date().toISOString() }]);
    try {
      await call("/public/messages", token, { text: t });
      // Safety net next to the socket: poll briefly until a reply arrives.
      for (let i = 0; i < 15; i++) {
        const me = await call<{ messages: Msg[] }>("/public/me", token);
        setMessages(me.messages);
        if (me.messages.at(-1)?.senderType !== "customer") break;
        await new Promise((r) => setTimeout(r, 700));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function control(controlId: string) {
    if (!token) return;
    await call("/public/control", token, { controlId });
    await refresh();
  }
  async function giveFeedback(m: Msg, up: boolean) {
    if (!m.aiActionId || feedback[m.aiActionId]) return;
    setFeedback({ ...feedback, [m.aiActionId]: up ? "up" : "down" });
    await control(`fb:${up ? "up" : "down"}:${m.aiActionId}`);
  }
  async function openDataRights() {
    if (!token) return;
    const r = await call<{ url: string }>("/public/data-rights/link", token, {});
    window.open(r.url, "_blank", "noopener");
  }

  if (!open) {
    return (
      <button type="button" class="launcher" onClick={() => setOpen(true)} aria-label="Buka layanan tanya PMB haloK@MPUS">
        <Ico d={CHAT} /> <span>Tanya PMB</span>
      </button>
    );
  }

  return (
    <section class="panel" role="dialog" aria-label="Layanan percakapan PMB haloK@MPUS" aria-modal="false">
      <header class="head">
        <div>
          <div class="title">haloK@MPUS</div>
          <div class="subtitle">Asisten PMB · dibantu AI, diawasi petugas</div>
        </div>
        <button type="button" class="icon" onClick={() => setOpen(false)} aria-label="Tutup"><Ico d={CLOSE} /></button>
      </header>

      {consents && !consents.service ? (
        <ConsentScreen
          onSubmit={async (c) => {
            const r = await call<{ consents: Consents }>("/public/consents", token, c);
            setConsents(r.consents);
          }}
        />
      ) : (
        <>
          <div class="list" ref={listRef} role="log" aria-live="polite" aria-label="Riwayat percakapan" tabIndex={0}>
            {messages.length === 0 ? <p class="hint">Halo! Tanyakan jadwal, biaya, persyaratan, atau status pendaftaran. Jawaban AI selalu menyertakan sumber resmi.</p> : null}
            {messages.map((m) => <Bubble key={m.id} m={m} feedback={m.aiActionId ? feedback[m.aiActionId] : undefined} onFeedback={giveFeedback} onButton={control} />)}
            {busy && messages.at(-1)?.senderType === "customer" ? <p class="typing" role="status">Asisten sedang menyiapkan jawaban…</p> : null}
          </div>
          {error ? <p class="error" role="alert">{error}</p> : null}
          {showUpload ? <Upload token={token} onDone={async () => { setShowUpload(false); await refresh(); }} /> : null}
          <div class="actions">
            <button type="button" class="human" onClick={() => void control("human")}><Ico d={PERSON} /> Bicara dengan manusia</button>
            <button type="button" class="link" onClick={() => void openDataRights()}>Data pribadi</button>
          </div>
          <form class="composer" onSubmit={send}>
            <button type="button" class="icon" aria-label="Periksa berkas" aria-expanded={showUpload} onClick={() => setShowUpload((v) => !v)}><Ico d={CLIP} /></button>
            <label class="sr" for="hk-input">Pesan</label>
            <input id="hk-input" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} placeholder="Tulis pertanyaan…" autocomplete="off" maxLength={4000} />
            <button type="submit" class="send" disabled={busy || !text.trim()} aria-label="Kirim"><Ico d={SEND} /></button>
          </form>
        </>
      )}
    </section>
  );
}

function Bubble({ m, feedback, onFeedback, onButton }: { m: Msg; feedback?: "up" | "down"; onFeedback: (m: Msg, up: boolean) => void; onButton: (id: string) => void }) {
  const mine = m.senderType === "customer";
  if (m.kind === "handoff_card") {
    return (
      <div class="card handoff" role="status">
        <div class="card-title">Diteruskan ke petugas</div>
        <p>{m.text}</p>
        {m.promise ? <p class="promise">{m.promise}</p> : null}
      </div>
    );
  }
  if (m.kind === "reminder") {
    return (
      <div class="card reminder">
        <div class="card-title">Pengingat</div>
        <p>{m.text}</p>
        {m.why ? <details><summary>Mengapa saya menerima ini?</summary><p>{m.why}</p></details> : null}
      </div>
    );
  }
  const who = mine ? "Anda" : m.senderType === "ai" ? "Asisten AI" : m.senderType === "cp" ? "Mahasiswa CP" : m.senderType === "staff" ? "Staf PMB" : "haloK@MPUS";
  const feedbackable = m.senderType === "ai" && (m.kind === "answer" || m.kind === "status") && m.aiActionId && !m.retracted;
  const extraButtons = (m.buttons ?? []).filter((b) => !b.id.startsWith("fb:") && b.id !== "human");
  return (
    <div class={`msg ${mine ? "mine" : "theirs"} ${m.retracted ? "retracted" : ""}`}>
      <div class="who">{who}</div>
      <p>{m.text}</p>
      {m.citations?.length ? <p class="src">Sumber: {m.citations.map((c) => `${c.title} — ${c.section}`).join("; ")}</p> : null}
      {extraButtons.length ? <div class="btns">{extraButtons.map((b) => <button key={b.id} type="button" class="chip" onClick={() => onButton(b.id)}>{b.title}</button>)}</div> : null}
      {feedbackable ? (
        <div class="fb" role="group" aria-label="Apakah jawaban ini membantu?">
          <button type="button" class={`icon ${feedback === "up" ? "on" : ""}`} aria-pressed={feedback === "up"} disabled={Boolean(feedback)} onClick={() => onFeedback(m, true)}><Ico d={UP} label="Membantu" /></button>
          <button type="button" class={`icon ${feedback === "down" ? "on" : ""}`} aria-pressed={feedback === "down"} disabled={Boolean(feedback)} onClick={() => onFeedback(m, false)}><Ico d={DOWN} label="Tidak membantu" /></button>
          {feedback ? <span class="thanks">Terima kasih atas umpan baliknya.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ConsentScreen({ onSubmit }: { onSubmit: (c: Consents) => Promise<void> }) {
  const [reminder, setReminder] = useState(false);
  const [improve, setImprove] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form class="consent" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSubmit({ service: true, proactive_reminder: reminder, service_improvement: improve }).finally(() => setBusy(false)); }}>
      <h2>Sebelum mulai</h2>
      <p>haloK@MPUS memproses pesan Anda untuk layanan helpdesk PMB, termasuk dengan bantuan AI yang diawasi Staf PMB. Kami hanya meminta data yang diperlukan (nama panggilan, nomor pendaftaran, email/WhatsApp, prodi, jalur, tahap).</p>
      <label class="check"><input type="checkbox" checked disabled /> <span><strong>Layanan helpdesk</strong> (wajib)</span></label>
      <label class="check"><input type="checkbox" checked={reminder} onChange={(e) => setReminder((e.target as HTMLInputElement).checked)} /> <span>Pengingat proaktif tenggat & kekurangan berkas (opsional)</span></label>
      <label class="check"><input type="checkbox" checked={improve} onChange={(e) => setImprove((e.target as HTMLInputElement).checked)} /> <span>Perbaikan layanan dengan data teranonimkan (opsional)</span></label>
      <p class="small">Persetujuan dapat ditarik kapan saja melalui tautan “Data pribadi”. Dasar: UU No. 27 Tahun 2022.</p>
      <button type="submit" class="primary" disabled={busy}>Setuju dan mulai</button>
    </form>
  );
}

function Upload({ token, onDone }: { token: string | null; onDone: () => void }) {
  const [docType, setDocType] = useState("pas_foto");
  const [busy, setBusy] = useState(false);
  return (
    <form class="upload" onSubmit={async (e) => {
      e.preventDefault();
      const input = (e.target as HTMLFormElement).querySelector("input[type=file]") as HTMLInputElement;
      if (!input.files?.[0]) return;
      const fd = new FormData();
      fd.append("docType", docType);
      fd.append("file", input.files[0]);
      setBusy(true);
      await call("/public/files", token, undefined, fd).catch(() => undefined);
      setBusy(false);
      onDone();
    }}>
      <p class="small">Periksa format & ukuran berkas sebelum diunggah ke portal. Berkas tidak disimpan oleh haloK@MPUS.</p>
      <label class="sr" for="hk-doctype">Jenis dokumen</label>
      <select id="hk-doctype" value={docType} onChange={(e) => setDocType((e.target as HTMLSelectElement).value)}>
        <option value="pas_foto">Pas foto</option>
        <option value="ijazah">Ijazah/SKL</option>
        <option value="rapor">Rapor</option>
      </select>
      <label class="sr" for="hk-file">Berkas</label>
      <input id="hk-file" type="file" required />
      <button type="submit" class="primary" disabled={busy}>{busy ? "Memeriksa…" : "Periksa berkas"}</button>
    </form>
  );
}

// ---------------------------------------------------------------- mount in Shadow DOM
const host = document.createElement("div");
host.id = "halokampus-widget";
document.body.appendChild(host);
const root = host.attachShadow({ mode: "open" });
const style = document.createElement("style");
style.textContent = CSS;
root.appendChild(style);
const mount = document.createElement("div");
root.appendChild(mount);
render(<Widget />, mount);
