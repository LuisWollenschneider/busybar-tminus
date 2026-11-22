/**
 * The presets: what each counts down to, how a repeating one finds its next moment, and their stored form. The
 * settings page cannot hold a list and an app cannot write its settings, so presets are made on the bar and kept in
 * localStorage; main.ts does the reading and writing.
 *
 * A preset's year, month, day (or a weekday) and hour may each be "every". The finest "every" decides how it repeats
 * and makes the coarser fields irrelevant: a day of WED repeats weekly whatever the year and month say.
 */

import { DAY_MS, HOUR_MS, MINUTE_MS, MONTHS, WEEKDAYS, daysInMonth, localMs, pad } from "./countdown.ts";

/** `day`: 1 to 31 a date, 0 every day, -1 to -7 Monday to Sunday. */
export const EVERY_DAY = 0;

export type Preset = {
  /** Upper-case ASCII; "" shows no label line. */
  label: string;
  /** null: every year. */
  year: number | null;
  /** 1 to 12; null: every month. */
  month: number | null;
  /** 1 to 31, EVERY_DAY, or -1 (Monday) to -7 (Sunday). */
  day: number;
  /** 0 to 23; null: every hour. */
  hour: number | null;
  minute: number;
  /** Only presets that are on are offered by the wheel. */
  on: boolean;
};

export type Rule = "once" | "yearly" | "monthly" | "weekly" | "daily" | "hourly";

/** Bounds the store and the heap. */
export const MAX_PRESETS = 20;

/** How long a repeating preset counts up after its moment before counting down to the next one. */
const CELEBRATE_MS: Record<Exclude<Rule, "once">, number> = {
  yearly: DAY_MS, monthly: DAY_MS, weekly: HOUR_MS, daily: 10 * MINUTE_MS, hourly: MINUTE_MS,
};

const WEEKDAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** The highest date the day can be: 29 for February when every year is asked for, 31 when every month is. */
export function maxDay(preset: Pick<Preset, "year" | "month">): number {
  return preset.month === null ? 31 : daysInMonth(preset.year ?? 2028, preset.month);
}

export function ruleOf(preset: Preset): Rule {
  if (preset.hour === null) return "hourly";
  if (preset.day === EVERY_DAY) return "daily";
  if (preset.day < 0) return "weekly";
  if (preset.month === null) return "monthly";
  if (preset.year === null) return "yearly";
  return "once";
}

/** The fields coarser than a rule's finest "every". */
export function ignoredFields(rule: Rule): Array<"year" | "month" | "day"> {
  switch (rule) {
    case "hourly": return ["year", "month", "day"];
    case "daily": case "weekly": return ["year", "month"];
    case "monthly": return ["year"];
    default: return [];
  }
}

/** A fresh bar: the New Year, every year. */
export function defaultPresets(): Preset[] {
  return [{ label: "NEW YEAR", year: null, month: 1, day: 1, hour: 0, minute: 0, on: true }];
}

/** "+ ADD NEW": a week from today at noon, once. */
export function newPreset(now: number, label: string): Preset {
  const d = new Date(now + 7 * DAY_MS);
  return { label, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: 12, minute: 0, on: true };
}

/** A repeating preset's moment in the `k`-th period from the one `now` is in (k = 0: this hour, day, week, ...). */
function occurrence(preset: Preset, rule: Exclude<Rule, "once">, now: number, k: number): number {
  const time = (preset.hour ?? 0) * HOUR_MS + preset.minute * MINUTE_MS;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const d = new Date(now);
  switch (rule) {
    case "hourly":
      return Math.floor(now / HOUR_MS) * HOUR_MS + k * HOUR_MS + preset.minute * MINUTE_MS;
    case "daily":
      return today + k * DAY_MS + time;
    case "weekly": {
      const monday = today - ((d.getUTCDay() + 6) % 7) * DAY_MS;
      return monday + (k * 7 + (-preset.day - 1)) * DAY_MS + time;
    }
    case "monthly": {
      const total = d.getUTCMonth() + k;
      const year = d.getUTCFullYear() + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12 + 1;
      return Date.UTC(year, month - 1, Math.min(preset.day, daysInMonth(year, month))) + time;
    }
    case "yearly": {
      const year = d.getUTCFullYear() + k;
      const month = preset.month ?? 1;
      return Date.UTC(year, month - 1, Math.min(preset.day, daysInMonth(year, month))) + time;
    }
  }
}

/**
 * The moment a preset counts towards at `now`, local ms. A one-off is fixed and counts up forever once passed; a
 * repeating one counts up for CELEBRATE_MS after each moment, then down to the next.
 */
export function presetTarget(preset: Preset, now: number): number {
  const rule = ruleOf(preset);
  if (rule === "once") {
    return localMs(preset.year as number, preset.month as number, preset.day, preset.hour as number, preset.minute)
      ?? Date.UTC(preset.year as number, (preset.month as number) - 1, 1);
  }
  let previous = -Infinity;
  let next = Infinity;
  for (let k = -1; k <= 2; k += 1) {
    const at = occurrence(preset, rule, now, k);
    if (at <= now) previous = Math.max(previous, at);
    else next = Math.min(next, at);
  }
  return now - previous < CELEBRATE_MS[rule] ? previous : next;
}

/** The label, or for a preset without one, what it counts down to in a few characters. */
export function presetName(preset: Preset): string {
  if (preset.label) return preset.label;
  const time = `${pad(preset.hour ?? 0)}:${pad(preset.minute)}`;
  switch (ruleOf(preset)) {
    case "hourly": return `HOURLY :${pad(preset.minute)}`;
    case "daily": return `DAILY ${time}`;
    case "weekly": return `EVERY ${WEEKDAYS[-preset.day - 1]} ${time}`;
    case "monthly": return `MONTHLY ${preset.day}`;
    case "yearly": return `EVERY ${preset.day} ${MONTHS[(preset.month ?? 1) - 1]}`;
    case "once": return `${preset.day} ${MONTHS[(preset.month ?? 1) - 1]} ${preset.year}`;
  }
}

/** The rule in words for the back display: "EVERY WEDNESDAY AT 09:00". */
export function describe(preset: Preset): string {
  const time = `${pad(preset.hour ?? 0)}:${pad(preset.minute)}`;
  const date = `${preset.day} ${MONTHS[(preset.month ?? 1) - 1]}`;
  switch (ruleOf(preset)) {
    case "hourly": return `EVERY HOUR AT :${pad(preset.minute)}`;
    case "daily": return `EVERY DAY AT ${time}`;
    case "weekly": return `EVERY ${WEEKDAY_NAMES[-preset.day - 1]} AT ${time}`;
    case "monthly": return `EVERY MONTH ON DAY ${preset.day} AT ${time}`;
    case "yearly": return `EVERY YEAR ON ${date} AT ${time}`;
    case "once": return `${date} ${preset.year} AT ${time}`;
  }
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/**
 * Stored as compact arrays, [label, year, month, day, hour, minute, on] with null for "every" and 0/1 for on.
 * Entries that do not read are dropped; nothing stored, or a store that does not parse, gives the defaults.
 */
export function parsePresets(text: string | null): Preset[] {
  let raw: unknown = null;
  try {
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  if (!Array.isArray(raw)) return defaultPresets();
  const presets: Preset[] = [];
  for (const entry of raw.slice(0, MAX_PRESETS)) {
    if (!Array.isArray(entry) || entry.length !== 7) continue;
    const [label, year, month, day, hour, minute, on] = entry as unknown[];
    if (typeof label !== "string" || !(year === null || isInt(year, 1970, 9999))
      || !(month === null || isInt(month, 1, 12)) || !(hour === null || isInt(hour, 0, 23)) || !isInt(minute, 0, 59)) {
      continue;
    }
    const preset: Preset = { label, year, month, day: 0, hour, minute, on: on === 1 };
    if (!isInt(day, -7, maxDay(preset))) continue;
    preset.day = day;
    presets.push(preset);
  }
  return presets;
}

export function serializePresets(presets: Preset[]): string {
  return JSON.stringify(presets.map((p) => [p.label, p.year, p.month, p.day, p.hour, p.minute, p.on ? 1 : 0]));
}
