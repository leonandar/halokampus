import type { WeeklyHours } from "@hk/shared";

/**
 * Business-hours calendar (PRM-07 / PRM-19). Works in any IANA time zone using Intl,
 * so no tz database dependency is needed. All inputs/outputs are UTC instants.
 */

interface LocalDate {
  y: number;
  m: number; // 1..12
  d: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function localParts(instant: number, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    ss: Number(parts.second),
  };
}

/** Offset (ms) of the zone at `instant`: local wall time minus UTC. */
function offsetAt(instant: number, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Converts a local wall time in `tz` to a UTC instant (ms). */
export function zonedTimeToUtc(date: LocalDate, hhmm: string, tz: string): number {
  const [hh = 0, mm = 0] = hhmm.split(":").map(Number);
  const guess = Date.UTC(date.y, date.m - 1, date.d, hh, mm, 0);
  let result = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(result, tz);
  if (second !== result) result = second;
  return result;
}

function localDateOf(instant: number, tz: string): LocalDate {
  const p = localParts(instant, tz);
  return { y: p.y, m: p.m, d: p.d };
}

function addDays(date: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function isoDate(date: LocalDate): string {
  return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
}

function isoWeekday(date: LocalDate): number {
  const wd = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay(); // 0 = Sunday
  return wd === 0 ? 7 : wd;
}

const MAX_SCAN_DAYS = 400;

export class BusinessCalendar {
  constructor(private readonly hours: WeeklyHours) {}

  /** Open intervals [start, end) in UTC ms for one local date. */
  intervalsOn(date: LocalDate): Array<[number, number]> {
    if (this.hours.holidays.includes(isoDate(date))) return [];
    const ranges = this.hours.days[String(isoWeekday(date)) as keyof WeeklyHours["days"]] ?? [];
    return ranges
      .map(([s, e]) => [zonedTimeToUtc(date, s, this.hours.timezone), zonedTimeToUtc(date, e, this.hours.timezone)] as [number, number])
      .filter(([s, e]) => e > s)
      .sort((a, b) => a[0] - b[0]);
  }

  private *intervalsFrom(instant: number): Generator<[number, number]> {
    // Start one day earlier so an interval spanning local midnight is not missed.
    let date = addDays(localDateOf(instant, this.hours.timezone), -1);
    for (let i = 0; i < MAX_SCAN_DAYS; i++) {
      for (const iv of this.intervalsOn(date)) if (iv[1] > instant) yield iv;
      date = addDays(date, 1);
    }
    throw new Error("No service hours configured within the scan window (check PRM-07/PRM-19)");
  }

  isOpen(at: Date): boolean {
    const t = at.getTime();
    for (const [s] of this.intervalsFrom(t)) return s <= t;
    return false;
  }

  /** `at` itself when open, otherwise the start of the next open interval. */
  nextOpening(at: Date): Date {
    const t = at.getTime();
    for (const [s] of this.intervalsFrom(t)) return new Date(Math.max(s, t));
    throw new Error("unreachable");
  }

  /** Adds `seconds` of open time to `start`. A result equal to a closing time is allowed. */
  addServiceSeconds(start: Date, seconds: number): Date {
    let remaining = seconds * 1000;
    let cursor = start.getTime();
    for (const [s, e] of this.intervalsFrom(cursor)) {
      const from = Math.max(cursor, s);
      const avail = e - from;
      if (remaining <= avail) return new Date(from + remaining);
      remaining -= avail;
      cursor = e;
    }
    throw new Error("unreachable");
  }

  /**
   * Adds `n` business days of working time. One business day = the total open time
   * of the first business day on/after `start`. Example (Mon–Fri 08–16): Mon 14:00 + 1
   * → Tue 14:00; Fri 14:00 + 1 → Mon 14:00; Sat 10:00 + 1 → Mon 16:00.
   */
  addBusinessDays(start: Date, n: number): Date {
    const opening = this.nextOpening(start);
    const date = localDateOf(opening.getTime(), this.hours.timezone);
    let dayLen = 0;
    for (let i = 0; i < MAX_SCAN_DAYS && dayLen === 0; i++) {
      dayLen = this.intervalsOn(addDays(date, i)).reduce((acc, [s, e]) => acc + (e - s), 0);
    }
    return this.addServiceSeconds(start, (n * dayLen) / 1000);
  }

  /** Formats an instant as a human Indonesian local time, e.g. "Senin, 17 Nov 2026 08.00 WIB". */
  formatLocal(at: Date): string {
    const tz = this.hours.timezone;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("id-ID", { timeZone: tz, weekday: "long", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    const zone = tz === "Asia/Jakarta" ? "WIB" : tz === "Asia/Makassar" ? "WITA" : tz === "Asia/Jayapura" ? "WIT" : tz;
    return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} pukul ${parts.hour}.${parts.minute} ${zone}`;
  }
}
