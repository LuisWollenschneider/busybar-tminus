/**
 * The preset menu as a state machine: list, actions, delete confirmation and editor. Each key gives the next state
 * and, when the presets changed, the list to store. "up" is the wheel clockwise.
 */

import { EVERY_DAY, MAX_PRESETS, ignoredFields, maxDay, newPreset, ruleOf, type Preset } from "./store.ts";

export type Key = "up" | "down" | "ok" | "back" | "start";

/** The editor's steps, coarse to fine. */
export const FIELDS = ["label", "year", "month", "day", "hour", "minute"] as const;
export type Field = (typeof FIELDS)[number];

export type Ui =
  | { mode: "countdown" }
  | { mode: "list"; cursor: number }
  | { mode: "actions"; index: number; cursor: number }
  | { mode: "confirm"; index: number }
  | { mode: "edit"; index: number | null; draft: Preset; field: Field; labels: string[] };

export type Step = {
  ui: Ui;
  /** Set when the presets changed. */
  presets?: Preset[];
  /** The preset the countdown shows next, by index. */
  show?: number;
  /** Name it on the countdown for a moment, as the wheel does. */
  announce?: boolean;
};

/** The labels setting's default in settings.json, for a bar that does not answer. */
export const STOCK_LABELS = [
  "COUNTDOWN", "LUNCH", "BIRTHDAY", "EXAM", "ANNIVERSARY", "CHRISTMAS", "NEW YEAR", "HOLIDAY", "VACATION", "TRIP",
  "WEDDING", "PARTY", "LAUNCH", "RELEASE", "DEADLINE", "DEMO", "MEETING", "STAND-UP", "HOME TIME", "WEEKEND", "PAYDAY",
];

/** How far into the future a year can be set. */
const YEARS_AHEAD = 99;

export const ACTIONS = ["EDIT", "SWITCH", "DELETE"] as const;

/** The editor steps that matter for a draft. */
export function fieldsFor(draft: Preset): Field[] {
  const ignored: readonly string[] = ignoredFields(ruleOf(draft));
  return FIELDS.filter((field) => !ignored.includes(field));
}

/** The setting's labels, then no label; the preset's own label first if it is neither. */
export function labelChoices(labels: string[], current: string): string[] {
  const choices: string[] = [];
  for (const label of [...labels, ""]) if (!choices.includes(label)) choices.push(label);
  if (!choices.includes(current)) choices.unshift(current);
  return choices;
}

const wrap = (value: number, min: number, max: number) => ((((value - min) % (max - min + 1)) + (max - min + 1)) % (max - min + 1)) + min;

/** `delta` steps from `current` in `values`, going round; a value not in the list counts as the first. */
function cycle<T>(values: readonly T[], current: T, delta: number): T {
  return values[wrap(Math.max(0, values.indexOf(current)) + delta, 0, values.length - 1)];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * The draft with one field moved by `delta`. Each field's "every" sits before its first value (the day: DAILY, then
 * MON to SUN). The year stops at its ends instead of going round; the date is clamped to its month.
 */
export function adjust(draft: Preset, field: Field, delta: number, labels: string[], thisYear: number): Preset {
  const next = { ...draft };
  switch (field) {
    case "label":
      next.label = cycle(labels, draft.label, delta);
      break;
    case "year": {
      const years = [null, ...range(Math.min(thisYear, draft.year ?? thisYear), thisYear + YEARS_AHEAD)];
      const at = Math.min(years.length - 1, Math.max(0, years.indexOf(draft.year) + delta));
      next.year = years[at];
      break;
    }
    case "month":
      next.month = cycle([null, ...range(1, 12)], draft.month, delta);
      break;
    case "day":
      next.day = cycle([EVERY_DAY, ...range(1, 7).map((d) => -d), ...range(1, maxDay(draft))], draft.day, delta);
      break;
    case "hour":
      next.hour = cycle([null, ...range(0, 23)], draft.hour, delta);
      break;
    case "minute":
      next.minute = wrap(draft.minute + delta, 0, 59);
      break;
  }
  if (next.day > 0) next.day = Math.min(next.day, maxDay(next));
  return next;
}

/** Rows of the list: one per preset, then "+ ADD NEW" while there is room. */
export const listLength = (presets: Preset[]) => presets.length + (presets.length < MAX_PRESETS ? 1 : 0);

function startEdit(index: number | null, draft: Preset, labels: string[]): Ui {
  return { mode: "edit", index, draft, field: "label", labels: labelChoices(labels, draft.label) };
}

function save(ui: Extract<Ui, { mode: "edit" }>, presets: Preset[]): Step {
  const next = [...presets];
  const draft = { ...ui.draft, on: true };
  const index = ui.index ?? next.length;
  next[index] = draft;
  return { ui: { mode: "list", cursor: index }, presets: next, show: index };
}

/** START in the list or actions: back to the countdown, on the highlighted preset if it is on. */
function showOnCountdown(presets: Preset[], index: number): Step {
  const countdown: Ui = { mode: "countdown" };
  return presets[index]?.on ? { ui: countdown, show: index, announce: true } : { ui: countdown };
}

/** The next menu state for a key. `now` (local ms) dates a new preset. The countdown's own keys are in main.ts. */
export function press(ui: Ui, presets: Preset[], key: Key, now: number, labels: string[]): Step {
  const delta = key === "up" ? 1 : key === "down" ? -1 : 0;
  switch (ui.mode) {
    case "countdown":
      return { ui };

    case "list": {
      const rows = listLength(presets);
      if (delta) return { ui: { mode: "list", cursor: wrap(ui.cursor + delta, 0, rows - 1) } };
      if (key === "back") return { ui: { mode: "countdown" } };
      if (key === "start") return showOnCountdown(presets, ui.cursor);
      if (key !== "ok") return { ui };
      if (ui.cursor < presets.length) return { ui: { mode: "actions", index: ui.cursor, cursor: 0 } };
      return { ui: startEdit(null, newPreset(now, labels[0] ?? ""), labels) };
    }

    case "actions": {
      if (delta) return { ui: { ...ui, cursor: wrap(ui.cursor + delta, 0, ACTIONS.length - 1) } };
      if (key === "back") return { ui: { mode: "list", cursor: ui.index } };
      if (key === "start") return showOnCountdown(presets, ui.index);
      if (key !== "ok") return { ui };
      const action = ACTIONS[ui.cursor];
      if (action === "EDIT") return { ui: startEdit(ui.index, presets[ui.index], labels) };
      if (action === "DELETE") return { ui: { mode: "confirm", index: ui.index } };
      const next = presets.map((p, i) => (i === ui.index ? { ...p, on: !p.on } : p));
      return { ui: { mode: "list", cursor: ui.index }, presets: next, show: next[ui.index].on ? ui.index : undefined };
    }

    case "confirm": {
      if (key === "back") return { ui: { mode: "actions", index: ui.index, cursor: ACTIONS.indexOf("DELETE") } };
      if (key !== "ok") return { ui };
      const next = presets.filter((_, i) => i !== ui.index);
      return { ui: { mode: "list", cursor: Math.min(ui.index, listLength(next) - 1) }, presets: next };
    }

    case "edit": {
      if (delta) {
        const thisYear = new Date(now).getUTCFullYear();
        return { ui: { ...ui, draft: adjust(ui.draft, ui.field, delta, ui.labels, thisYear) } };
      }
      if (key === "start") return save(ui, presets);
      const fields = fieldsFor(ui.draft);
      const at = fields.indexOf(ui.field);
      if (key === "back") {
        if (at > 0) return { ui: { ...ui, field: fields[at - 1] } };
        // Leaving the first step drops the draft.
        return { ui: ui.index === null ? { mode: "list", cursor: presets.length } : { mode: "actions", index: ui.index, cursor: 0 } };
      }
      if (key !== "ok") return { ui };
      return at + 1 < fields.length ? { ui: { ...ui, field: fields[at + 1] } } : save(ui, presets);
    }
  }
}
