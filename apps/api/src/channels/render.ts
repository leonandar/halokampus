import { CHANNEL_CAPS, type ChannelCode } from "@hk/shared";
import type { Button, OutboundMessage } from "./types.js";

/**
 * Channel-neutral text rendering (FR-56). Every channel shows the same content: answer,
 * sources, promised time, "why am I receiving this", and the available actions. When a
 * channel cannot show the buttons natively they become numbered options to type.
 */
export function composeBody(msg: OutboundMessage): string {
  let body = msg.text;
  if (msg.promise) body += `\n\n⏱ ${msg.promise}`;
  if (msg.citations?.length) body += `\n\nSumber: ${msg.citations.map((c) => `${c.title} — ${c.section} (v${c.version})`).join("; ")}`;
  if (msg.why) body += `\n\nMengapa saya menerima ini? ${msg.why}`;
  return body;
}

export interface Rendered {
  body: string;
  buttons: Button[];
  textOptions?: Record<string, string>;
}

export function renderFor(channel: ChannelCode, msg: OutboundMessage): Rendered {
  const body = composeBody(msg);
  const buttons = msg.buttons ?? [];
  if (buttons.length === 0) return { body, buttons: [] };
  if (buttons.length <= CHANNEL_CAPS[channel].maxButtons) return { body, buttons };
  const textOptions: Record<string, string> = {};
  const lines: string[] = [];
  let n = 1;
  for (const b of buttons) {
    const key = b.id === "human" ? "MANUSIA" : b.id === "consent:yes" ? "SETUJU" : String(n++);
    textOptions[key] = b.id;
    lines.push(`${key} = ${b.title}`);
  }
  return { body: `${body}\n\nBalas dengan: ${lines.join(" · ")}`, buttons: [], textOptions };
}

/** Removes quoted history and signatures from an email reply so only the new text remains. */
export function stripEmailReply(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(On|Pada) .+(wrote|menulis):\s*$/i.test(line)) break;
    if (/^-{2,}\s*$/.test(line) || /^-----Original Message-----/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}
