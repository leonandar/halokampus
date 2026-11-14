import type { SlaDuration } from "@hk/shared";
import type { BusinessCalendar } from "./calendar.js";

export interface SlaWindow {
  /** When the clock starts running (may be later than the trigger, outside service hours). */
  startsAt: Date;
  deadlineAt: Date;
}

/**
 * Computes an SLA window (FR-09).
 * - `seconds`: wall clock (PRM-02, AI).
 * - `service_seconds`: only inside service hours (PRM-03 under decision Q4-b).
 * - `business_days`: working days from the PRM-07 calendar (PRM-04, PRM-05).
 */
export function computeSlaWindow(trigger: Date, duration: SlaDuration, calendar: BusinessCalendar): SlaWindow {
  switch (duration.unit) {
    case "seconds":
      return { startsAt: trigger, deadlineAt: new Date(trigger.getTime() + duration.value * 1000) };
    case "service_seconds": {
      const startsAt = calendar.nextOpening(trigger);
      return { startsAt, deadlineAt: calendar.addServiceSeconds(startsAt, duration.value) };
    }
    case "business_days": {
      const startsAt = calendar.nextOpening(trigger);
      return { startsAt, deadlineAt: calendar.addBusinessDays(startsAt, duration.value) };
    }
  }
}

/** Deadlines are inclusive: a response at exactly the deadline meets the SLA (KB-03). */
export function isSlaMet(respondedAt: Date, deadlineAt: Date): boolean {
  return respondedAt.getTime() <= deadlineAt.getTime();
}

export function isSlaBreached(now: Date, deadlineAt: Date): boolean {
  return now.getTime() > deadlineAt.getTime();
}
