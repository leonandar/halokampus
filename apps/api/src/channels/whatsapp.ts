import { createHmac } from "node:crypto";
import type { PrismaClient } from "@hk/db";
import { safeEqual } from "../crypto.js";
import { renderFor } from "./render.js";
import { simulatorSend } from "./transport.js";
import type { ChannelAdapter, OutboundMessage, Recipient, SendResult } from "./types.js";

/** Normalised inbound item parsed from any channel webhook. */
export interface InboundItem {
  from: string;
  providerMessageId: string;
  profileName?: string;
  text?: string;
  /** Interactive reply id (feedback, "human", consent, survey…). */
  controlId?: string;
}

export interface StatusItem {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
}

/** WhatsApp Cloud API webhook: messages and statuses. */
export function parseWhatsAppWebhook(body: any): InboundItem[] {
  const out: InboundItem[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value ?? {};
      const name = v.contacts?.[0]?.profile?.name as string | undefined;
      for (const m of v.messages ?? []) {
        if (m.type === "text") out.push({ from: String(m.from), providerMessageId: String(m.id), profileName: name, text: String(m.text?.body ?? "") });
        else if (m.type === "interactive") {
          const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
          out.push({ from: String(m.from), providerMessageId: String(m.id), profileName: name, controlId: String(r?.id ?? ""), text: String(r?.title ?? "") });
        } else if (m.type === "document" || m.type === "image") {
          // Attachments are not stored (data minimisation); the customer gets a secure upload link instead.
          out.push({ from: String(m.from), providerMessageId: String(m.id), profileName: name, text: "[lampiran]" });
        }
      }
    }
  }
  return out;
}

export function parseWhatsAppStatuses(body: any): StatusItem[] {
  const out: StatusItem[] = [];
  for (const entry of body?.entry ?? []) for (const change of entry?.changes ?? []) for (const s of change?.value?.statuses ?? []) {
    if (["sent", "delivered", "read", "failed"].includes(s.status)) out.push({ providerMessageId: String(s.id), status: s.status });
  }
  return out;
}

/** Verifies `X-Hub-Signature-256` (Meta: WhatsApp, Messenger, Instagram) when an app secret is configured (NFR-05). */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret) return true;
  if (!header?.startsWith("sha256=")) return false;
  return safeEqual(signMeta(rawBody, appSecret), header);
}

export function signMeta(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

export function renderWhatsApp(to: string, msg: OutboundMessage) {
  const r = renderFor("whatsapp", msg);
  const payload = r.buttons.length
    ? {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: { type: "button", body: { text: r.body.slice(0, 1024) }, action: { buttons: r.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) } },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: r.body.slice(0, 4096) } };
  return { payload, textOptions: r.textOptions };
}

export class WhatsAppChannel implements ChannelAdapter {
  readonly code = "whatsapp" as const;
  constructor(
    private readonly mode: "simulator" | "cloud_api",
    private readonly db: PrismaClient,
    private readonly cloud?: { phoneNumberId: string; accessToken: string },
  ) {}
  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    const { payload, textOptions } = renderWhatsApp(to.externalId, msg);
    if (this.mode === "simulator") {
      const id = await simulatorSend(this.db, "whatsapp", to.externalId, payload, { messageId: msg.messageId, kind: msg.kind, sender: msg.senderLabel });
      return { providerMessageId: id, textOptions };
    }
    if (!this.cloud) throw new Error("WhatsApp Cloud API credentials missing");
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.cloud.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.cloud.accessToken}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: HTTP ${res.status}`);
    const body = (await res.json()) as { messages?: Array<{ id: string }> };
    return { providerMessageId: body.messages?.[0]?.id ?? null, textOptions };
  }
}
