export const CHANNEL_LABEL: Record<string, string> = {
  web: "Web", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", email: "Email", telegram: "Telegram", phone: "Telepon",
};
export const ROLE_LABEL: Record<string, string> = { cp: "Mahasiswa CP", staff: "Staf PMB", leader: "Pimpinan PMB", finance: "Unit Keuangan", admin: "Admin TI" };
export const STATUS_LABEL: Record<string, string> = {
  T1_AI: "Ditangani AI", T2_WAITING: "Menunggu CP", T2_ACTIVE: "Ditangani CP", T3_WAITING: "Menunggu Staf", T3_ACTIVE: "Ditangani Staf",
  RESOLVED_AI: "Selesai (AI)", RESOLVED: "Selesai", REOPENED: "Dibuka ulang", CLOSED: "Ditutup",
};
export const SENDER_LABEL: Record<string, string> = { customer: "Calon mahasiswa", ai: "Asisten AI", cp: "Mahasiswa CP", staff: "Staf PMB", system: "Sistem" };

const fmt = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const time = (iso: string) => `${fmt.format(new Date(iso))} WIB`;
export const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${(x * 100).toFixed(1)}%`);
