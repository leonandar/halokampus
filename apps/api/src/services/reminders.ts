import { runGuard } from "@hk/ai";
import type { Ctx } from "../context.js";
import { hasConsent, profileOf } from "./customers.js";
import { appendEvent } from "./ledger.js";
import { latestConversation, sendOutbound } from "./messaging.js";
import { dataRightsLink } from "./pipeline.js";

/**
 * Proactive reminders (FR-16): only verified customers who granted the
 * `proactive_reminder` purpose, only for missing documents before a deadline, always
 * with "mengapa saya menerima ini".
 */
export async function runReminders(ctx: Ctx): Promise<{ sent: number; skipped: number; reasons: Record<string, number> }> {
  const now = ctx.clock.now();
  const cfg = ctx.config.reminders;
  const cal = await ctx.params.workCalendar();
  const customers = await ctx.db.customer.findMany({ where: { verifiedAt: { not: null }, anonymizedAt: null } });
  let sent = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {};
  const skip = (r: string) => { skipped++; reasons[r] = (reasons[r] ?? 0) + 1; };
  for (const c of customers) {
    if (!(await hasConsent(ctx, c.id, "proactive_reminder"))) { skip("no_consent"); continue; }
    const recent = await ctx.db.event.findFirst({ where: { type: "reminder_sent", customerPseudoId: c.pseudoId, occurredAt: { gt: new Date(now.getTime() - cfg.minIntervalHours * 3600_000) } } });
    if (recent) { skip("recently_sent"); continue; }
    const regNo = profileOf(ctx, c).regNo;
    const a = regNo ? await ctx.pmb.getApplicant(regNo).catch(() => null) : null;
    const deadline = a?.deadlines.find((d) => d.code === cfg.deadlineCode);
    const missing = a?.documents.filter((d) => d.status === "belum_unggah" || d.status === "ditolak") ?? [];
    if (!a || !deadline || missing.length === 0) { skip(!a ? "no_applicant" : !deadline ? "no_deadline" : "complete"); continue; }
    const at = new Date(deadline.at);
    const msLeft = at.getTime() - now.getTime();
    if (msLeft <= 0 || msLeft > cfg.leadDays * 86400_000) { skip("outside_window"); continue; }
    const text = `Pengingat: ${missing.map((d) => d.label).join(", ")} belum diunggah. ${deadline.label}: ${cal.formatLocal(at)}.`;
    const guard = runGuard({ actionKey: "reminder.send", outputText: text }, ctx.config.guard);
    if (!guard.passed) { skip("guard"); continue; }
    const conv = await latestConversation(ctx, c.id);
    const link = await dataRightsLink(ctx, c, conv.channelCode);
    const action = await ctx.db.aiAction.create({
      data: { agent: "action", actionType: "reminder.send", authorityClass: guard.authorityClass, category: "persyaratan", guard: guard as object, routing: { kind: "answer" }, outcome: "sent", outputEnc: ctx.crypto.encrypt(text), channelCode: conv.channelCode, createdAt: now },
    });
    await sendOutbound(ctx, {
      conversation: conv,
      ticketId: null,
      sender: "ai",
      kind: "reminder",
      text,
      why: `Anda menyetujui "Pengingat proaktif", dan sistem PMB mencatat berkas di atas belum diunggah menjelang tenggat. Data yang dipakai: status berkas & tenggat. Berhenti kapan saja: ${link}`,
      aiActionId: action.id,
      customerPseudoId: c.pseudoId,
      isDummy: c.isDummy,
    });
    await appendEvent(ctx.db, { occurredAt: now, type: "reminder_sent", customerPseudoId: c.pseudoId, channel: conv.channelCode, actorType: "ai", payload: { aiActionId: action.id, missing: missing.map((d) => d.docType) }, isDummy: c.isDummy });
    sent++;
  }
  return { sent, skipped, reasons };
}
