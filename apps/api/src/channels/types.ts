import type { ChannelCode } from "@hk/shared";

export interface Citation {
  title: string;
  section: string;
  version: number;
}

export interface Button {
  id: string;
  title: string;
}

/** Channel-neutral outbound message; each adapter renders it for its capabilities (FR-44/56). */
export interface OutboundMessage {
  messageId: string;
  kind: "text" | "answer" | "handoff_card" | "reminder" | "system" | "file_check" | "status" | "consent_prompt" | "human_reply";
  text: string;
  senderLabel: string;
  citations?: Citation[];
  buttons?: Button[];
  /** "Mengapa saya menerima ini" for proactive messages (FR-16). */
  why?: string;
  /** Promised response time on hand-off cards (FR-11). */
  promise?: string;
  aiActionId?: string;
  createdAt: string;
}

export interface Recipient {
  customerId: string;
  externalId: string;
}

export interface SendResult {
  /** Provider message id, used to match delivery/read receipts. */
  providerMessageId?: string | null;
  /** Buttons that had to be rendered as typed options ("1", "2", "MANUSIA" → control id). */
  textOptions?: Record<string, string>;
}

export interface ChannelAdapter {
  readonly code: ChannelCode;
  send(to: Recipient, msg: OutboundMessage): Promise<SendResult | void>;
}

export type ChannelRegistry = Partial<Record<ChannelCode, ChannelAdapter>>;
