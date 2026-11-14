import type { Realtime } from "../context.js";
import type { ChannelAdapter, OutboundMessage, Recipient } from "./types.js";

/** Web widget: delivers the semantic message as-is over the customer socket. */
export class WebChannel implements ChannelAdapter {
  readonly code = "web" as const;
  constructor(private readonly realtime: Realtime) {}
  async send(to: Recipient, msg: OutboundMessage): Promise<void> {
    this.realtime.toCustomer(to.customerId, "message", msg);
  }
}
