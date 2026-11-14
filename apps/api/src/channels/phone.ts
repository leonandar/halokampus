import type { ChannelAdapter, SendResult } from "./types.js";

/**
 * Phone/call-centre logging (FR-51). Replies are spoken by the officer during the call
 * and recorded by them, so there is nothing to deliver. A VoIP adapter can replace this.
 */
export class PhoneChannel implements ChannelAdapter {
  readonly code = "phone" as const;
  async send(): Promise<SendResult> {
    return { providerMessageId: null };
  }
}
