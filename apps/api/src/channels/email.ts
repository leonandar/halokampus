import type { PrismaClient } from "@hk/db";
import type { Mailer } from "../services/mailer.js";
import { renderFor, stripEmailReply } from "./render.js";
import { simulatorSend } from "./transport.js";
import type { ChannelAdapter, OutboundMessage, Recipient, SendResult } from "./types.js";
import type { InboundItem } from "./whatsapp.js";

/**
 * Email (FR-49). Inbound: a JSON webhook ({from, name, subject, text, messageId}) that an
 * inbound-parse service or an IMAP relay posts to; quoted history is stripped.
 * Outbound: SMTP. Email has no buttons, so actions become typed options.
 */
export function parseInboundEmail(body: any): InboundItem[] {
  const from = String(body?.from ?? "").trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, "$1");
  if (!/^[^@\s]+@[^@\s]+$/.test(from)) return [];
  const hasAttachments = Array.isArray(body?.attachments) && body.attachments.length > 0;
  const text = hasAttachments ? "[lampiran]" : stripEmailReply(String(body?.text ?? ""));
  return [{ from, providerMessageId: String(body?.messageId ?? `email.${Date.now()}`), profileName: body?.name ? String(body.name) : undefined, text }];
}

export function renderEmail(to: string, msg: OutboundMessage) {
  const r = renderFor("email", msg);
  const subject = msg.kind === "handoff_card" ? "Pertanyaan Anda diteruskan ke petugas PMB" : msg.kind === "reminder" ? "Pengingat PMB" : "Balasan layanan PMB haloK@MPUS";
  const footer = "\n\n—\nhaloK@MPUS · Layanan PMB. Balas email ini untuk melanjutkan percakapan. Ketik MANUSIA untuk dilayani petugas.";
  return { payload: { to, subject, text: `${r.body}${footer}` }, textOptions: r.textOptions };
}

export class EmailChannel implements ChannelAdapter {
  readonly code = "email" as const;
  constructor(private readonly mode: "simulator" | "smtp", private readonly db: PrismaClient, private readonly mailer: Mailer) {}
  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    const { payload, textOptions } = renderEmail(to.externalId, msg);
    if (this.mode === "simulator") {
      return { providerMessageId: await simulatorSend(this.db, "email", to.externalId, payload, { messageId: msg.messageId, kind: msg.kind, sender: msg.senderLabel }), textOptions };
    }
    await this.mailer.send(payload.to, payload.subject, payload.text);
    return { providerMessageId: null, textOptions };
  }
}
