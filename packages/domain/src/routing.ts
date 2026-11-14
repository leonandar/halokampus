import { isMandatoryCategory, type EscalationReason, type Tier } from "@hk/shared";
import { isBelowThreshold } from "./threshold.js";

export interface RoutingInput {
  category: string;
  customerRequestedHuman: boolean;
  /** Consecutive "not helpful" feedback in this ticket, including the current message. */
  negativeFeedbackStreak: number;
  aiPaused: boolean;
  /** Present only when an answer was actually drafted. */
  draft?: {
    confidence: number;
    retrievalTop: number;
    guardPassed: boolean;
  };
  thresholds: {
    /** PRM-01 */
    confidence: number;
    /** PRM-10 */
    minRetrieval: number;
  };
}

export type RoutingDecision =
  | { kind: "answer" }
  | { kind: "escalate"; tier: Exclude<Tier, "T1">; reason: EscalationReason; mandatory: boolean };

/**
 * Single source of truth for the Tier-1 routing rules (aturan perutean 1–2, FR-03/05/06).
 * Order matters: mandatory categories win over everything, then explicit human requests.
 */
export function decideRoute(input: RoutingInput): RoutingDecision {
  if (isMandatoryCategory(input.category)) {
    return { kind: "escalate", tier: "T3", reason: "MANDATORY_CATEGORY", mandatory: true };
  }
  if (input.customerRequestedHuman) return esc("CUSTOMER_REQUESTED_HUMAN");
  if (input.aiPaused) return esc("AI_PAUSED");
  if (input.negativeFeedbackStreak >= 2) return esc("NEGATIVE_FEEDBACK_X2");
  if (!input.draft) return esc("AI_UNAVAILABLE");
  if (isBelowThreshold(input.draft.retrievalTop, input.thresholds.minRetrieval)) return esc("OUT_OF_KB");
  if (!input.draft.guardPassed) return esc("GUARD_BLOCKED");
  if (isBelowThreshold(input.draft.confidence, input.thresholds.confidence)) return esc("LOW_CONFIDENCE");
  return { kind: "answer" };
}

function esc(reason: EscalationReason): RoutingDecision {
  return { kind: "escalate", tier: "T2", reason, mandatory: false };
}
