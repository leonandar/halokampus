import type { TicketStatus, Tier } from "@hk/shared";

/** Allowed ticket status transitions (ARSITEKTUR §5). */
const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  T1_AI: ["RESOLVED_AI", "T2_WAITING", "T3_WAITING"],
  T2_WAITING: ["T2_ACTIVE", "T3_WAITING", "RESOLVED"],
  T2_ACTIVE: ["T3_WAITING", "RESOLVED", "T2_WAITING"],
  T3_WAITING: ["T3_ACTIVE", "RESOLVED", "T2_WAITING"],
  T3_ACTIVE: ["RESOLVED", "T2_WAITING"],
  RESOLVED_AI: ["REOPENED", "CLOSED", "T2_WAITING", "T3_WAITING"],
  RESOLVED: ["REOPENED", "CLOSED"],
  REOPENED: ["T1_AI", "T2_WAITING", "T3_WAITING"],
  CLOSED: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export class InvalidTransitionError extends Error {
  constructor(public from: TicketStatus, public to: TicketStatus) {
    super(`Invalid ticket transition ${from} -> ${to}`);
  }
}

export function tierOf(status: TicketStatus): Tier | null {
  if (status.startsWith("T1")) return "T1";
  if (status.startsWith("T2")) return "T2";
  if (status.startsWith("T3")) return "T3";
  return null;
}

export function isOpenStatus(status: TicketStatus): boolean {
  return !["RESOLVED_AI", "RESOLVED", "CLOSED"].includes(status);
}
