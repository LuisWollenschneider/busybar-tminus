/** The preset menu as display elements: the menu on the front, what the keys do on the back. */

import { ACTIONS, fieldsFor, listLength, type Field, type Ui } from "./editor.ts";
import { BACK_W, FRONT_H, FRONT_W, labelLine, rect, text, type Element } from "./frame.ts";
import { inkTop, textWidth, type Font } from "./fonts.ts";
import { MONTHS, WEEKDAYS, pad } from "./countdown.ts";
import { describe, presetName, ruleOf, type Preset } from "./store.ts";

const ACCENT = "#3FD8FFFF";
const DIM = "#5A7A85FF";
const ON = "#5BE37DFF";
const OFF = "#4A4A4AFF";
const DANGER = "#FF3B30FF";
const AMBER = "#FFB020FF";
const HINT = "#B0B0B0FF";

/** The two lines of the front display: the ink of `small` capitals on rows 1-5 and 9-13. */
const ROW_A = 1;
const ROW_B = 9;
const FONT: Font = "small";

const FIELD_TITLES: Record<Field, string> = {
  label: "LABEL", year: "YEAR", month: "MONTH", day: "DAY", hour: "HOUR", minute: "MINUTE",
};

/** `value` cut to `width` pixels, with ".." where it was cut. */
function fit(value: string, width: number, font: Font): string {
  if (textWidth(value, font) <= width) return value;
  let cut = value;
  while (cut.length > 0 && textWidth(`${cut}..`, font) > width) cut = cut.slice(0, -1);
  return `${cut}..`;
}

/** The back display: one line per key and what it does. */
function hints(lines: Array<[string, string]>): Element[] {
  return lines.flatMap(([key, does], i) => {
    const y = 8 + i * 16 - inkTop("large");
    return [
      text(`m_bk${i}`, key, 4, y, "large", "#FFFFFFFF", { display: "back" }),
      text(`m_bd${i}`, does, 64, y, "large", HINT, { display: "back" }),
    ];
  });
}

function listRows(ui: Extract<Ui, { mode: "list" }>, presets: Preset[]): Element[] {
  const rows = listLength(presets);
  // The cursor's row and the next; the last row shows with the one before.
  const first = Math.max(0, Math.min(ui.cursor, rows - 2));
  const elements: Element[] = [];
  for (let line = 0; line < 2 && first + line < rows; line += 1) {
    const i = first + line;
    const selected = i === ui.cursor;
    const row = line === 0 ? ROW_A : ROW_B;
    const y = row - inkTop(FONT);
    const marker = selected ? ">" : " ";
    if (i === presets.length) {
      elements.push(text(`m_n${line}`, `${marker}+ ADD NEW`, 0, y, FONT, selected ? ACCENT : DIM));
      continue;
    }
    const preset = presets[i];
    const status = preset.on ? "ON" : "OFF";
    const statusWidth = textWidth(status, FONT);
    // Two columns are kept free on the right for the scroll mark.
    elements.push(text(`m_s${line}`, status, FRONT_W - 2 - statusWidth, y, FONT, preset.on ? ON : OFF));
    const name = fit(presetName(preset), FRONT_W - statusWidth - 4 - textWidth(marker, FONT), FONT);
    elements.push(text(`m_n${line}`, `${marker}${name}`, 0, y, FONT, selected ? ACCENT : preset.on ? "#FFFFFFFF" : DIM));
  }
  // A two-pixel scroll mark on the right edge when the list is longer than the display.
  if (rows > 2) {
    const h = Math.max(2, Math.round((2 / rows) * FRONT_H));
    elements.push(rect("m_scroll", FRONT_W - 1, Math.round((first / rows) * FRONT_H), 1, Math.min(h, FRONT_H), [DIM]));
  }
  return elements;
}

/** "< VALUE >" centred on the second line. */
function choice(value: string, color: string): Element {
  return labelLine("m_v", `< ${value} >`, 0, FRONT_W, ROW_B, ["small", "tiny"], color, {});
}

type Part = [string, Field | null];

/** The moment in the editor, only the parts that matter: "24 DEC 2026 18:00", "YEARLY 24 DEC 18:00", "HOURLY :30". */
export function momentParts(draft: Preset): Part[] {
  const time: Part[] = [[" ", null], [pad(draft.hour ?? 0), "hour"], [":", null], [pad(draft.minute), "minute"]];
  const date: Part[] = [[String(draft.day), "day"], [" ", null], [MONTHS[(draft.month ?? 1) - 1], "month"]];
  switch (ruleOf(draft)) {
    case "hourly": return [["HOURLY", "hour"], [" :", null], [pad(draft.minute), "minute"]];
    case "daily": return [["DAILY", "day"], ...time];
    case "weekly": return [["EVERY ", null], [WEEKDAYS[-draft.day - 1], "day"], ...time];
    case "monthly": return [["MONTHLY", "month"], [" ", null], [String(draft.day), "day"], ...time];
    case "yearly": return [["YEARLY", "year"], [" ", null], ...date, ...time];
    case "once": return [...date, [" ", null], [String(draft.year), "year"], ...time];
  }
}

/** The moment, the part being changed underlined in the accent colour; gaps shrink to 1 px when it is too wide. */
function momentLine(draft: Preset, field: Field): Element[] {
  const parts = momentParts(draft);
  // The last character's letter spacing takes no ink.
  const inkWidth = (gap: number) =>
    parts.reduce((sum, [part]) => sum + (part === " " ? gap : textWidth(part, FONT)), 0) - 1;
  const gap = inkWidth(textWidth(" ", FONT)) <= FRONT_W ? textWidth(" ", FONT) : 1;
  let x = Math.max(0, Math.floor((FRONT_W - inkWidth(gap)) / 2));
  const elements: Element[] = [];
  parts.forEach(([part, which], i) => {
    if (part === " ") {
      x += gap;
      return;
    }
    const active = which === field;
    const w = textWidth(part, FONT);
    elements.push(text(`m_d${i}`, part, x, ROW_B - inkTop(FONT), FONT, active ? ACCENT : DIM));
    if (active) elements.push(rect("m_u", x, FRONT_H - 1, Math.max(3, w - 1), 1, [ACCENT]));
    x += w;
  });
  return elements;
}

function editor(ui: Extract<Ui, { mode: "edit" }>): Element[] {
  const fields = fieldsFor(ui.draft);
  const counter = `${fields.indexOf(ui.field) + 1}/${fields.length}`;
  const y = ROW_A - inkTop(FONT);
  const elements: Element[] = [
    text("m_t", FIELD_TITLES[ui.field], 0, y, FONT, DIM),
    text("m_c", counter, FRONT_W - textWidth(counter, FONT), y, FONT, DIM),
  ];
  if (ui.field === "label") elements.push(choice(ui.draft.label || "NO LABEL", ACCENT));
  else elements.push(...momentLine(ui.draft, ui.field));
  return elements;
}

export function menuFrame(ui: Ui, presets: Preset[]): Element[] {
  switch (ui.mode) {
    case "countdown":
      return [];
    case "list":
      return [...listRows(ui, presets), ...hints([["WHEEL", "CHOOSE"], ["OK", "OPEN"], ["START", "SHOW IT"], ["BACK", "COUNTDOWN"]])];
    case "actions": {
      const preset = presets[ui.index];
      const action = ACTIONS[ui.cursor] === "SWITCH" ? (preset.on ? "TURN OFF" : "TURN ON") : ACTIONS[ui.cursor];
      return [
        labelLine("m_t", presetName(preset), 0, FRONT_W, ROW_A, ["small", "tiny"], DIM, {}),
        choice(action, ACTIONS[ui.cursor] === "DELETE" ? DANGER : action === "TURN OFF" ? AMBER : ACCENT),
        ...hints([["WHEEL", "CHOOSE"], ["OK", "DO IT"], ["START", "SHOW IT"], ["BACK", "LIST"]]),
      ];
    }
    case "confirm":
      return [
        labelLine("m_t", "DELETE?", 0, FRONT_W, ROW_A, ["small"], DANGER, {}),
        labelLine("m_v", presetName(presets[ui.index]), 0, FRONT_W, ROW_B, ["small", "tiny"], "#FFFFFFFF", {}),
        ...hints([["OK", "DELETE"], ["BACK", "KEEP IT"]]),
      ];
    case "edit":
      return [
        ...editor(ui),
        ...hints([["WHEEL", "CHANGE"], ["OK", "NEXT"], ["START", "SAVE"], ["BACK", "PREVIOUS"]]),
        labelLine("m_b9", describe(ui.draft), 0, BACK_W, 72, ["small"], HINT, { display: "back" }),
      ];
  }
}
