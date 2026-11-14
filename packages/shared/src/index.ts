// Shared vocabulary for haloK@MPUS. Codes here are stable identifiers stored in the
// database and in the `events` table; never rename a value once data exists.

export const PRODUCT_NAME = "haloK@MPUS";

// ---------------------------------------------------------------- roles & RBAC
export const ROLES = ["cp", "staff", "leader", "finance", "admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Server-side permission table (SRS §6). Every protected route declares exactly one
 * permission; the API hook rejects any role not listed here with HTTP 403 + audit.
 */
export const PERMISSIONS = {
  "tickets.t2.read": ["cp", "staff"],
  "tickets.t2.work": ["cp", "staff"],
  "tickets.t3.read": ["staff", "finance"],
  "tickets.t3.work": ["staff"],
  "tickets.escalate": ["cp", "staff"],
  "presence.set": ["cp", "staff"],
  "customer.pii.unmask": ["staff"],
  "ai.supervise": ["staff"],
  "ai.override": ["staff"],
  "ai.pause": ["staff"],
  "audit.read": ["staff", "leader"],
  "kb.read": ["cp", "staff", "leader"],
  "kb.manage": ["staff"],
  "params.read": ["staff", "leader"],
  "params.propose": ["staff", "leader"],
  "params.approve": ["staff", "leader"],
  "users.manage": ["admin"],
  "channels.manage": ["admin"],
  "phone.log": ["cp", "staff"],
  "kpi.read": ["staff", "leader"],
  "reports.read": ["staff", "leader"],
  "research.export": ["staff", "leader"],
  "qa.review": ["staff"],
  "cp.supervise": ["staff"],
  "orchestration.manage": ["staff"],
  "orchestration.read": ["staff", "leader"],
  "dsr.manage": ["staff"],
  "feedback.read_own": ["cp"],
  "usability.respond": ["cp", "staff", "leader", "finance", "admin"],
  "self.read": ["cp", "staff", "leader", "finance", "admin"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export function roleHas(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

// ---------------------------------------------------------------- channels
export const CHANNELS = ["web", "whatsapp", "instagram", "messenger", "email", "telegram", "phone"] as const;
export type ChannelCode = (typeof CHANNELS)[number];

// ---------------------------------------------------------------- tickets
export const TIERS = ["T1", "T2", "T3"] as const;
export type Tier = (typeof TIERS)[number];

export const TICKET_STATUSES = [
  "T1_AI",
  "T2_WAITING",
  "T2_ACTIVE",
  "T3_WAITING",
  "T3_ACTIVE",
  "RESOLVED_AI",
  "RESOLVED",
  "REOPENED",
  "CLOSED",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Ticket categories. The five `mandatory: true` categories go straight to Tier 3. */
export const CATEGORIES = {
  info_umum: { label: "Informasi umum", mandatory: false },
  jadwal: { label: "Jadwal & tenggat", mandatory: false },
  biaya: { label: "Biaya (informasi)", mandatory: false },
  persyaratan: { label: "Persyaratan & berkas", mandatory: false },
  status: { label: "Status pendaftaran", mandatory: false },
  teknis: { label: "Kendala teknis", mandatory: false },
  data_pribadi: { label: "Hak data pribadi", mandatory: false },
  lainnya: { label: "Lainnya", mandatory: false },
  pembayaran: { label: "Pembayaran", mandatory: true },
  perubahan_data: { label: "Perubahan data", mandatory: true },
  pengecualian: { label: "Permintaan pengecualian", mandatory: true },
  jalur_khusus: { label: "Jalur/kelompok khusus", mandatory: true },
  keluhan_berat: { label: "Keluhan berat/emosi tinggi", mandatory: true },
} as const;
export type Category = keyof typeof CATEGORIES;
export const MANDATORY_CATEGORIES = (Object.keys(CATEGORIES) as Category[]).filter((c) => CATEGORIES[c].mandatory);
export function isMandatoryCategory(c: string): boolean {
  return (MANDATORY_CATEGORIES as string[]).includes(c);
}

// ---------------------------------------------------------------- escalation reasons
export const ESCALATION_REASONS = {
  LOW_CONFIDENCE: "Skor keyakinan di bawah ambang PRM-01",
  OUT_OF_KB: "Topik di luar basis pengetahuan (di bawah PRM-10)",
  CUSTOMER_REQUESTED_HUMAN: "Pelanggan meminta manusia",
  NEGATIVE_FEEDBACK_X2: "Dua umpan balik negatif berturut-turut",
  MANDATORY_CATEGORY: "Kategori wajib Tingkat 3",
  GUARD_BLOCKED: "Diblokir agen penjaga kebijakan",
  AI_PAUSED: "AI sedang dijeda",
  AI_UNAVAILABLE: "Penyedia AI gagal atau melewati SLA PRM-02",
  PMB_UNAVAILABLE: "Data pendaftaran tidak tersedia",
  SLA_BREACH_T2: "SLA Tingkat 2 terlewati",
  CP_ESCALATED: "Dieskalasi Mahasiswa CP",
  STAFF_RETURNED: "Dikembalikan Staf ke Mahasiswa CP",
  PHONE_CALL: "Panggilan telepon (dicatat petugas)",
} as const;
export type EscalationReason = keyof typeof ESCALATION_REASONS;

// ---------------------------------------------------------------- AI authority
export const AUTHORITY_CLASSES = ["allowed", "must_escalate", "forbidden"] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

export const OVERRIDE_TYPES = ["cancel", "replace", "correct"] as const;
export type OverrideType = (typeof OVERRIDE_TYPES)[number];

export const OVERRIDE_CAUSES = {
  factual_error: "Kesalahan fakta",
  outdated_kb: "Basis pengetahuan usang",
  wrong_scope: "Tidak sesuai prodi/jalur/tahap",
  tone: "Nada/empati tidak tepat",
  policy_violation: "Melanggar kebijakan/kewenangan",
  incomplete: "Jawaban tidak lengkap",
  other: "Lainnya",
} as const;
export type OverrideCause = keyof typeof OVERRIDE_CAUSES;

// ---------------------------------------------------------------- consent (UU PDP)
export const CONSENT_PURPOSES = {
  service: { label: "Layanan helpdesk PMB", required: true },
  proactive_reminder: { label: "Pengingat proaktif (tenggat & kekurangan berkas)", required: false },
  service_improvement: { label: "Perbaikan layanan (analisis teranonimkan)", required: false },
} as const;
export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;

export const DSR_TYPES = {
  access: "Melihat data saya",
  copy: "Mengunduh salinan data saya",
  correct: "Mengoreksi data saya",
  withdraw: "Menarik persetujuan",
  delete: "Menghapus data saya",
} as const;
export type DsrType = keyof typeof DSR_TYPES;

// ---------------------------------------------------------------- events (KPI source)
/** Catalogue of event types (ARSITEKTUR §7). The `events` table only accepts these. */
export const EVENT_TYPES = [
  "conversation_started",
  "message_received",
  "message_sent",
  "customer_inactive_timeout",
  "ai_answer_sent",
  "ai_action_executed",
  "ai_guard_blocked",
  "ai_fallback",
  "ai_feedback",
  "ticket_opened",
  "ticket_claimed",
  "first_human_response",
  "ticket_resolved",
  "ticket_reopened",
  "ticket_closed",
  "ticket_returned",
  "escalation",
  "escalation_mandatory",
  "handoff",
  "sla_started",
  "sla_met",
  "sla_breach",
  "override_applied",
  "ai_paused",
  "ai_resumed",
  "kb_published",
  "parameter_proposed",
  "parameter_changed",
  "qa_review_submitted",
  "presence_changed",
  "handling_started",
  "handling_ended",
  "survey_sent",
  "survey_answered",
  "consent_granted",
  "consent_withdrawn",
  "identity_linked",
  "dsr_opened",
  "dsr_closed",
  "pii_accessed",
  "retention_run",
  "reminder_sent",
  "delivery_status",
  "channel_toggled",
  "cp_feedback_given",
  "orchestration_item",
  "orchestration_closed",
  "export_generated",
  "report_generated",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------- policy parameters
/** Parameter codes. Values live in `policy_parameters`; nothing here is a default value. */
export const PARAM_CODES = [
  "PRM-01", "PRM-02", "PRM-03", "PRM-04", "PRM-05", "PRM-06", "PRM-07", "PRM-08", "PRM-09", "PRM-10",
  "PRM-11", "PRM-12", "PRM-13", "PRM-14", "PRM-15", "PRM-16", "PRM-17", "PRM-18", "PRM-19", "PRM-20",
] as const;
export type ParamCode = (typeof PARAM_CODES)[number];

export interface WeeklyHours {
  /** ISO weekday 1 = Monday … 7 = Sunday → list of [start, end) "HH:MM" ranges. */
  days: Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", Array<[string, string]>>>;
  timezone: string;
  /** Holidays as local dates YYYY-MM-DD. */
  holidays: string[];
}

export interface ConfidenceWeights {
  retrieval: number;
  intent: number;
  self: number;
}

export interface SlaDuration {
  /** "seconds" = wall clock; "service_seconds" = only inside service hours; "business_days" = PRM-07 calendar. */
  unit: "seconds" | "service_seconds" | "business_days";
  value: number;
}

/**
 * Channel capabilities used to render one semantic message per channel (FR-44/56).
 * `maxButtons` = interactive replies the provider renders natively; beyond that the
 * adapter falls back to numbered text options that the customer answers by typing.
 */
export const CHANNEL_CAPS: Record<ChannelCode, { label: string; maxButtons: number; attachmentsInline: boolean; humanOperated: boolean }> = {
  web: { label: "Web", maxButtons: 10, attachmentsInline: true, humanOperated: false },
  whatsapp: { label: "WhatsApp", maxButtons: 3, attachmentsInline: false, humanOperated: false },
  instagram: { label: "Instagram", maxButtons: 13, attachmentsInline: false, humanOperated: false },
  messenger: { label: "Messenger", maxButtons: 13, attachmentsInline: false, humanOperated: false },
  telegram: { label: "Telegram", maxButtons: 8, attachmentsInline: false, humanOperated: false },
  email: { label: "Email", maxButtons: 0, attachmentsInline: false, humanOperated: false },
  phone: { label: "Telepon", maxButtons: 0, attachmentsInline: false, humanOperated: true },
};
