/** Both displays for one moment, as display elements. Nothing here talks to the device. */

import { formatGap, formatTarget, stateFor, type State } from "./countdown.ts";
import { fitFont, inkHeight, inkTop, textWidth, type Font } from "./fonts.ts";

/** One element as POST /api/display/draw takes it. */
export type Element = Record<string, unknown> & { id: string };

export const FRONT_W = 72;
export const FRONT_H = 16;
/** The back display without the firmware's status bar on its right. */
export const BACK_W = 148;
export const BACK_H = 80;

const BAR_H = 2;

/** Per state: the accent colour, and the dim one for the label and the bar's track. */
const PALETTE: Record<State, [string, string]> = {
  calm: ["#3FD8FF", "#0E4657"],
  warning: ["#FFB020", "#4A2E00"],
  danger: ["#FF3B30", "#4A0B08"],
  expired: ["#FFFFFF", "#FF2A1F"],
};

/** The status light blinks this colour once as the countdown enters each state. */
export const LED_ALERT: Partial<Record<State, string>> = {
  warning: "#FFB020FF",
  danger: "#FF3B30FF",
  expired: "#FF2A1FFF",
};

/** "#RRGGBB" and an alpha of 0..1 as "#RRGGBBAA". */
export function rgba(rgb: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return `${rgb}${a < 16 ? "0" : ""}${a.toString(16).toUpperCase()}`;
}

/** The colour `t` (0..1) of the way from `a` to `b`, both "#RRGGBB". */
export function mix(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  let out = "#";
  for (let i = 1; i < 7; i += 2) {
    const from = parseInt(a.slice(i, i + 2), 16);
    const to = parseInt(b.slice(i, i + 2), 16);
    const v = Math.round(from + (to - from) * k);
    out += `${v < 16 ? "0" : ""}${v.toString(16).toUpperCase()}`;
  }
  return out;
}

export function text(id: string, value: string, x: number, y: number, font: Font, color: string, extra: object = {}): Element {
  return { id, type: "text", text: value, x, y, font, color, align: "top_left", ...extra };
}

/** border_width 0: the firmware's default of 1 paints a white outline. */
export function rect(id: string, x: number, y: number, w: number, h: number, colors: string[], fill = "solid", extra: object = {}): Element {
  return {
    id, type: "rectangle", x, y,
    width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)),
    fill, fill_colors: colors, border_width: 0, ...extra,
  };
}

const NUMBER_CHARS = "0123456789:+.";
/** At most this many runs of digits and words in one value ("1y 2mo" is 4). */
const MAX_RUNS = 6;

/** Alternating runs of digits and words: "5h 00m" is 5 / "h " / 00 / "m". */
function splitRuns(value: string): Array<[string, boolean]> {
  const runs: Array<[string, boolean]> = [];
  for (const ch of value) {
    const isNumber = NUMBER_CHARS.includes(ch);
    const last = runs[runs.length - 1];
    if (last && last[1] === isNumber) last[0] += ch;
    else runs.push([ch, isNumber]);
  }
  return runs;
}

/**
 * The value centred in `width`, ink from `firstRow` to `lastRow`, in the first of `fonts` that fits. `extra_large`
 * has capitals only, so with it the words go in `large` beside the digits, on one baseline, one element per run.
 */
function valueLine(prefix: string, value: string, left: number, width: number, firstRow: number, lastRow: number,
  fonts: readonly Font[], color: string, extra: object): Element[] {
  const runs = splitRuns(value);
  if (fonts[0] === "extra_large" && runs.length > 1 && runs.length <= MAX_RUNS) {
    const total = runs.reduce((sum, [part, num]) => sum + textWidth(part, num ? "extra_large" : "large"), 0);
    if (total <= width) {
      const baseline = firstRow + inkHeight("extra_large") - 1;
      let x = left + Math.floor((width - total) / 2);
      return runs.map(([part, num], i) => {
        const font: Font = num ? "extra_large" : "large";
        const el = text(`${prefix}${i}`, part, x, baseline - inkHeight(font) + 1 - inkTop(font), font, color, extra);
        x += textWidth(part, font);
        return el;
      });
    }
  }
  const fitting = fonts.filter((f) => firstRow + inkHeight(f) - 1 <= lastRow);
  const font = fitFont(value, fitting.length > 0 ? fitting : fonts, width);
  const x = left + Math.max(0, Math.floor((width - textWidth(value, font)) / 2));
  return [text(`${prefix}0`, value, x, firstRow - inkTop(font), font, color, extra)];
}

/** A centred line of text, handed to the firmware's scroller when it does not fit. */
export function labelLine(id: string, value: string, left: number, width: number, row: number, fonts: readonly Font[],
  color: string, extra: object): Element {
  const font = fitFont(value, fonts, width);
  const y = row - inkTop(font);
  const w = textWidth(value, font);
  if (w > width) {
    return text(id, value, left, y, font, color, {
      ...extra, width, scroll_rate: 900, scroll_start_delay: 1500, scroll_repeat_delay: 2200,
    });
  }
  return text(id, value, left + Math.floor((width - w) / 2), y, font, color, extra);
}

export type Input = {
  /** Local ms. */
  now: number;
  target: number;
  warningMs: number;
  dangerMs: number;
  label: string;
  /** Shown on the label line instead, even in the final hour: the preset the wheel just switched to. */
  announce?: string;
  /** START flips between the time left and the target's date and time. */
  showTarget: boolean;
};

/** `perSecond`: the frame changes every second (the final hour, or the first hour past zero); else every minute. */
export type Frame = { elements: Element[]; state: State; perSecond: boolean };

/**
 * Front: a label line (dropped in the final hour), the value in the largest font that fits, and a bar that drains
 * through the current unit. In red with the seconds showing, the value and the background beat on alternate seconds,
 * riding on the redraw the seconds need anyway.
 *
 * Back: the label, the value, the target's date and the bar, without the beat.
 */
export function buildFrame(input: Input): Frame {
  const { now, target, label } = input;
  const remaining = target - now;
  const state = stateFor(remaining, input.warningMs, input.dangerMs);
  const [accent, dim] = PALETTE[state];
  const overdue = state === "expired";

  const gap = overdue ? formatGap(target, now, true) : formatGap(now, target, false);
  const perSecond = gap.tier === "seconds";
  const [targetDate, targetTime] = formatTarget(target);
  const drain = overdue ? 0 : (remaining % gap.unitMs) / gap.unitMs;
  const beating = perSecond && (overdue || state === "danger");
  const pulse = beating && Math.floor(now / 1000) % 2 === 1 ? 0.55 : 1;

  const elements: Element[] = [];

  // Front display.
  if (overdue) {
    // Darkest at the top so the text stays readable.
    const glow = beating ? pulse : 0.75;
    elements.push(rect("bg", 0, 0, FRONT_W, FRONT_H,
      [rgba(mix("#280402", dim, glow * 0.25), 1), rgba(mix("#6E0D08", dim, glow), 1)], "gradient_v", { z_index: 1 }));
  }
  elements.push(rect("track", 0, FRONT_H - BAR_H, FRONT_W, BAR_H, [rgba(dim, 0.5)], "solid", { z_index: 2 }));
  if (!overdue) {
    elements.push(rect("fill", 0, FRONT_H - BAR_H, Math.max(1, Math.round(drain * FRONT_W)), BAR_H,
      [rgba(accent, 0.28), rgba(accent, 1)], "gradient_h", { z_index: 3 }));
  }

  const finalHour = perSecond && !overdue;
  const head = input.announce ?? (input.showTarget ? targetDate : finalHour ? "" : label);
  const value = input.showTarget ? targetTime : gap.text;
  if (head) {
    const color = rgba(mix(dim, accent, overdue ? 0.9 : 0.75), 0.7 + 0.3 * pulse);
    elements.push(labelLine("label", head, 0, FRONT_W, 0, ["small", "tiny"], color, { z_index: 4 }));
  }
  // Without a label the value takes the whole display.
  const fonts: readonly Font[] = head
    ? ["condensed", "small", "tiny"]
    : ["extra_large", "large", "condensed", "small", "tiny"];
  elements.push(...valueLine("v", value, 0, FRONT_W, head ? 6 : 2, FRONT_H - BAR_H - 1, fonts,
    rgba(accent, 0.45 + 0.55 * pulse), { z_index: 5 }));

  // Back display.
  const back = { display: "back" };
  const backAccent = rgba(overdue ? PALETTE.danger[0] : accent, 1);
  const backDim = rgba(mix(dim, accent, 0.6), 1);
  if (label) elements.push(labelLine("b_label", label, 0, BACK_W, 10, ["large", "condensed", "small"], backDim, back));
  elements.push(...valueLine("b_v", gap.text, 0, BACK_W, 32, 50, ["extra_large", "large", "condensed"], backAccent, back));
  elements.push(labelLine("b_when", `${targetDate} ${targetTime}`, 0, BACK_W, 58, ["small", "tiny"], backDim, back));
  elements.push(rect("b_track", 0, BACK_H - 4, BACK_W, 3, [rgba(dim, 1)], "solid", { ...back, z_index: 1 }));
  if (!overdue) {
    elements.push(rect("b_fill", 0, BACK_H - 4, Math.max(1, Math.round(drain * BACK_W)), 3, [rgba(accent, 1)], "solid",
      { ...back, z_index: 2 }));
  }
  return { elements, state, perSecond };
}

/** A note instead of a countdown, e.g. when every preset is off. */
export function messageFrame(title: string, message: string): Element[] {
  return [
    labelLine("label", title, 0, FRONT_W, 1, ["small", "tiny"], "#FFB020FF", {}),
    labelLine("v0", message, 0, FRONT_W, 9, ["small", "tiny"], "#FFFFFFFF", {}),
    labelLine("b_label", title, 0, BACK_W, 20, ["large"], "#FFB020FF", { display: "back" }),
    labelLine("b_v0", message, 0, BACK_W, 44, ["small"], "#FFFFFFFF", { display: "back" }),
  ];
}
