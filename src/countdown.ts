/**
 * The countdown's arithmetic, free of the device: calendar helpers, how much detail a gap is shown with, and the
 * urgency state.
 *
 * Every moment is "local ms": the bar's wall-clock time written as if it were UTC, so the getUTC* calls read the bar's
 * own date and time. main.ts adds the bar's time zone offset to its UTC clock.
 */

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export type State = "calm" | "warning" | "danger" | "expired";

export type Tier = "seconds" | "hours" | "days" | "weeks" | "months" | "years";

export type Gap = {
  /** e.g. "05:42", "5h 03m", "2d 7h", "in 12 days", "3mo 4d", "1y 2mo". */
  text: string;
  tier: Tier;
  /** The unit the progress bar drains through: a minute in the final hour, an hour within a day, else a day. */
  unitMs: number;
};

export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Monday first, as the presets number the weekdays. */
export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** `month` is 1 to 12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Local ms for a calendar date and time; null when the fields do not make a real date (31 April, 25:00). */
export function localMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** The same day and time `count` months later, the day clamped to the month it lands in. */
export function addMonths(when: number, count: number): number {
  const d = new Date(when);
  const total = d.getUTCMonth() + count;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month0 + 1));
  return Date.UTC(year, month0, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** Whole calendar months from `start` to `end`, and the milliseconds left over. */
export function calendarSplit(start: number, end: number): [number, number] {
  const a = new Date(start);
  const b = new Date(end);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  while (months > 0 && addMonths(start, months) > end) months -= 1;
  while (addMonths(start, months + 1) <= end) months += 1;
  return [months, end - addMonths(start, months)];
}

/** The gap from `earlier` to `later`, coarser the longer it is. `overdue` writes it as a count-up with a "+". */
export function formatGap(earlier: number, later: number, overdue: boolean): Gap {
  const ms = Math.max(0, later - earlier);
  const sign = overdue ? "+" : "";
  if (ms < HOUR_MS) {
    const seconds = Math.floor(ms / SECOND_MS);
    return { text: `${sign}${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`, tier: "seconds", unitMs: MINUTE_MS };
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return { text: `${sign}${hours}h ${pad(minutes)}m`, tier: "hours", unitMs: HOUR_MS };
  }
  if (ms < 7 * DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
    return { text: `${sign}${days}d ${hours}h`, tier: "days", unitMs: DAY_MS };
  }
  const [months, rest] = calendarSplit(earlier, later);
  if (months < 1) {
    const days = Math.floor(ms / DAY_MS);
    return { text: overdue ? `+${days} days` : `in ${days} days`, tier: "weeks", unitMs: DAY_MS };
  }
  const restDays = Math.floor(rest / DAY_MS);
  if (months < 12) return { text: `${sign}${months}mo ${restDays}d`, tier: "months", unitMs: DAY_MS };
  return { text: `${sign}${Math.floor(months / 12)}y ${months % 12}mo`, tier: "years", unitMs: DAY_MS };
}

/** ["THU 31 DEC 2026", "23:59"]. */
export function formatTarget(target: number): [string, string] {
  const d = new Date(target);
  const date = `${WEEKDAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return [date, `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`];
}

export function stateFor(remainingMs: number, warningMs: number, dangerMs: number): State {
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= dangerMs) return "danger";
  if (remainingMs <= warningMs) return "warning";
  return "calm";
}

/** The settings' durations: "90s", "15m", "6h", "3d", "2w". */
export function parseDuration(spec: string): number | null {
  const m = /^(\d+)([smhdw])$/.exec(spec.trim());
  if (!m) return null;
  const unit = { s: SECOND_MS, m: MINUTE_MS, h: HOUR_MS, d: DAY_MS, w: 7 * DAY_MS }[m[2] as "s" | "m" | "h" | "d" | "w"];
  return Number(m[1]) * unit;
}

/** Upper case, and a dot for anything outside printable ASCII, which the bitmap fonts lack. */
export function cleanLabel(raw: string): string {
  let out = "";
  for (const ch of raw.trim().toUpperCase()) {
    const code = ch.charCodeAt(0);
    out += ch.length === 1 && code >= 0x20 && code <= 0x7e ? ch : ".";
  }
  return out;
}
