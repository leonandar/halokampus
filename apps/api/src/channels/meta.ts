import type { PrismaClient } from "@hk/db";
import { renderFor } from "./render.js";
import { simulatorSend } from "./transport.js";
import type { ChannelAdapter, OutboundMessage, Recipient, SendResult } from "./types.js";
import type { InboundItem, StatusItem } from "./whatsapp.js";

/**
 * Facebook Messenger and Instagram DM share the Messenger Platform webhook format
 * (`object` = "page" | "instagram") and the Graph API Send endpoint (FR-47/48).
 */
export function parseMetaMessaging(body: any): { channel: "messenger" | "instagram" | null; items: InboundItem[]; statuses: StatusItem[] } {
  const channel = body?.object === "page" ? "messenger" : body?.object === "instagram" ? "instagram" : null;
  const items: InboundItem[] = [];
  const statuses: StatusItem[] = [];
  for (const entry of body?.entry ?? []) {
    for (const ev of entry?.messaging ?? []) {
      const from = String(ev.sender?.id ?? "");
      if (ev.message && !ev.message.is_echo) {
        const qr = ev.message.quick_reply?.payload;
        if (qr) items.push({ from, providerMessageId: String(ev.message.mid), controlId: String(qr), text: String(ev.message.text ?? "") });
        else if (ev.message.text) items.push({ from, providerMessageId: String(ev.message.mid), text: String(ev.message.text) });
        else if (ev.message.attachments) items.push({ from, providerMessageId: String(ev.message.mid), text: "[lampiran]" });
      } else if (ev.postback?.payload) {
        items.push({ from, providerMessageId: String(ev.postback.mid ?? `pb.${Date.now()}`), controlId: String(ev.postback.payload), text: String(ev.postback.title ?? "") });
      } else if (ev.delivery?.mids) {
        for (const mid of ev.delivery.mids) statuses.push({ providerMessageId: String(mid), status: "delivered" });
      } else if (ev.read?.mid) {
        statuses.push({ providerMessageId: String(ev.read.mid), status: "read" });
      }
    }
  }
  return { channel, items, statuses };
}

export function renderMeta(channel: "messenger" | "instagram", to: string, msg: OutboundMessage) {
  const r = renderFor(channel, msg);
  const message: Record<string, unknown> = { text: r.body.slice(0, channel === "instagram" ? 1000 : 2000) };
  if (r.buttons.length) message.quick_replies = r.buttons.map((b) => ({ content_type: "text", title: b.title.slice(0, 20), payload: b.id }));
  return { payload: { recipient: { id: to }, messaging_type: "RESPONSE", message }, textOptions: r.textOptions };
}

export class MetaChannel implements ChannelAdapter {
  constructor(
    readonly code: "messenger" | "instagram",
    private readonly mode: "simulator" | "graph",
    private readonly db: PrismaClient,
    private readonly pageAccessToken?: string,
  ) {}
  async send(to: Recipient, msg: OutboundMessage): Promise<SendResult> {
    const { payload, textOptions } = renderMeta(this.code, to.externalId, msg);
    if (this.mode === "simulator") {
      return { providerMessageId: await simulatorSend(this.db, this.code, to.externalId, payload, { messageId: msg.messageId, kind: msg.kind, sender: msg.senderLabel }), textOptions };
    }
    if (!this.pageAccessToken) throw new Error(`${this.code}: page access token missing`);
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(this.pageAccessToken)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${this.code} send failed: HTTP ${res.status}`);
    const body = (await res.json()) as { message_id?: string };
    return { providerMessageId: body.message_id ?? null, textOptions };
  }
}
