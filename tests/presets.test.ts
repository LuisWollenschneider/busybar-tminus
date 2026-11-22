import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_MS, HOUR_MS, MINUTE_MS, localMs } from "../src/countdown.ts";
import { FIELDS, STOCK_LABELS, adjust, fieldsFor, labelChoices, press, type Key, type Ui } from "../src/editor.ts";
import { menuFrame, momentParts } from "../src/menu.ts";
import { textWidth } from "../src/fonts.ts";
import {
  EVERY_DAY, MAX_PRESETS, defaultPresets, describe, newPreset, parsePresets, presetName, presetTarget, ruleOf,
  serializePresets, type Preset,
} from "../src/store.ts";

/** Sunday 22 November 2026, 12:00, bar time. */
const now = localMs(2026, 11, 22, 12) as number;
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => localMs(y, mo, d, h, mi) as number;
const christmas: Preset = { label: "CHRISTMAS", year: 2026, month: 12, day: 24, hour: 18, minute: 0, on: true };
const WED = -3;

/** Runs keys from `ui` and returns the last state, the presets after all of them and the last preset to show. */
function run(ui: Ui, presets: Preset[], keys: Key[], labels: string[] = STOCK_LABELS) {
  let step = { ui, presets, show: undefined as number | undefined, announce: false };
  for (const key of keys) {
    const next = press(step.ui, step.presets, key, now, labels);
    step = { ui: next.ui, presets: next.presets ?? step.presets, show: next.show ?? step.show, announce: next.announce ?? false };
  }
  return step;
}

test("a fresh bar counts down to the New Year, every year", () => {
  const [preset] = parsePresets(null);
  assert.equal(ruleOf(preset), "yearly");
  assert.equal(presetTarget(preset, now), at(2027, 1, 1));
  assert.equal(presetName(preset), "NEW YEAR");
});

test("the finest every decides how a preset repeats", () => {
  assert.equal(ruleOf(christmas), "once");
  assert.equal(ruleOf({ ...christmas, year: null }), "yearly");
  assert.equal(ruleOf({ ...christmas, month: null }), "monthly");
  assert.equal(ruleOf({ ...christmas, day: WED }), "weekly");
  assert.equal(ruleOf({ ...christmas, day: EVERY_DAY, month: null }), "daily");
  assert.equal(ruleOf({ ...christmas, hour: null, day: WED }), "hourly");
});

test("each rule finds its next moment, and counts up for a while after one", () => {
  const p = (over: Partial<Preset>) => presetTarget({ ...christmas, ...over }, now);
  assert.equal(p({}), at(2026, 12, 24, 18));
  assert.equal(p({ year: null, month: 11, day: 1 }), at(2027, 11, 1, 18), "yearly, passed weeks ago");
  assert.equal(p({ month: null, day: 31 }), at(2026, 11, 30, 18), "monthly on the 31st: the last day of November");
  assert.equal(p({ day: WED, hour: 9 }), at(2026, 11, 25, 9), "next Wednesday 9:00");
  assert.equal(p({ day: -7, hour: 13 }), at(2026, 11, 22, 13), "today is Sunday, later today");
  assert.equal(p({ day: EVERY_DAY, hour: 17 }), at(2026, 11, 22, 17), "the next 5 pm");
  assert.equal(p({ day: EVERY_DAY, hour: 11, minute: 55 }), at(2026, 11, 22, 11, 55), "5 min ago: still counting up");
  assert.equal(p({ day: EVERY_DAY, hour: 11, minute: 45 }), at(2026, 11, 23, 11, 45), "15 min ago: tomorrow's");
  assert.equal(p({ hour: null, minute: 30 }), at(2026, 11, 22, 12, 30), "hourly at :30");
  assert.equal(presetTarget({ ...christmas, hour: null, minute: 0 }, now + 30 * 1000), now, "hourly, 30 s after");
  assert.equal(presetTarget({ ...christmas, hour: null, minute: 0 }, now + 2 * MINUTE_MS), now + HOUR_MS);
  assert.equal(p({ year: 2026, month: 11, day: 1 }), at(2026, 11, 1, 18), "a passed one-off counts up");
});

test("a yearly 29 February falls on the 28th in a common year", () => {
  assert.equal(presetTarget({ ...christmas, year: null, month: 2, day: 29 }, now), at(2027, 2, 28, 18));
  assert.equal(presetTarget({ ...christmas, year: null, month: 2, day: 29 }, at(2027, 12, 1)), at(2028, 2, 29, 18));
});

test("presets survive the store, and broken entries are dropped", () => {
  const weekly = { ...christmas, label: "", year: null, month: null, day: WED, hour: null, on: false };
  assert.deepEqual(parsePresets(serializePresets([christmas, weekly])), [christmas, weekly]);
  assert.deepEqual(parsePresets('[["X",2027,2,30,0,0,1],"junk",["Y",2027,2,28,0,0,1],["Z",null,2,29,0,0,1]]')
    .map((p) => p.label), ["Y", "Z"]);
  assert.deepEqual(parsePresets("not json"), defaultPresets());
  const many = JSON.stringify(Array(30).fill(JSON.parse(serializePresets([christmas]))[0]));
  assert.equal(parsePresets(many).length, MAX_PRESETS);
});

test("the editor goes year, month, day, hour, minute, skipping what the finest every makes irrelevant", () => {
  assert.deepEqual(fieldsFor(christmas), [...FIELDS]);
  assert.deepEqual(fieldsFor({ ...christmas, month: null }), ["label", "month", "day", "hour", "minute"]);
  assert.deepEqual(fieldsFor({ ...christmas, day: WED }), ["label", "day", "hour", "minute"]);
  assert.deepEqual(fieldsFor({ ...christmas, hour: null }), ["label", "hour", "minute"]);
});

test("each field's every comes before its first value", () => {
  assert.equal(adjust({ ...christmas, year: 2026 }, "year", -1, [], 2026).year, null);
  assert.equal(adjust({ ...christmas, year: null }, "year", -1, [], 2026).year, null, "the year stops at its ends");
  assert.equal(adjust({ ...christmas, month: 1 }, "month", -1, [], 2026).month, null);
  assert.equal(adjust({ ...christmas, day: 1 }, "day", -1, [], 2026).day, -7, "before the 1st: SUN");
  assert.equal(adjust({ ...christmas, day: -1 }, "day", -1, [], 2026).day, EVERY_DAY, "before MON: DAILY");
  assert.equal(adjust({ ...christmas, day: EVERY_DAY }, "day", -1, [], 2026).day, 31, "round to the last date");
  assert.equal(adjust({ ...christmas, hour: 0 }, "hour", -1, [], 2026).hour, null);
  assert.equal(adjust({ ...christmas, month: 1, day: 31 }, "month", 1, [], 2026).day, 28, "kept inside February");
});

test("making a countdown to every Wednesday at 9:00", () => {
  // + ADD NEW, keep the label, OK past the year and month, the day back to WED, the hour to 9, save at the minute.
  const start: Ui = { mode: "list", cursor: 1 };
  const toWed = Array<Key>(28 + 5).fill("down"); // from the 29th down to the 1st, then SUN, SAT, FRI, THU, WED
  const step = run(start, [christmas], ["ok", "ok", "ok", "ok", ...toWed, "ok", "down", "down", "down", "ok", "ok"]);
  const added = step.presets[1];
  assert.equal(added.day, WED);
  assert.equal(added.hour, 9);
  assert.equal(ruleOf(added), "weekly");
  assert.equal(describe(added), "EVERY WEDNESDAY AT 09:00");
  assert.deepEqual(step.ui, { mode: "list", cursor: 1 });
  assert.equal(step.show, 1);
});

test("Back skips the steps the draft no longer needs", () => {
  const editing: Ui = { mode: "edit", index: 0, draft: { ...christmas, day: WED }, field: "hour", labels: [] };
  const back = run(editing, [christmas], ["back", "back"]);
  assert.equal(back.ui.mode === "edit" && back.ui.field, "label");
});

test("START saves at any step; Back on the first step drops the draft", () => {
  const saved = run({ mode: "list", cursor: 0 }, [christmas], ["ok", "ok", "ok", "ok", "ok", "down", "start"]);
  assert.equal(saved.presets[0].day, 23);
  const dropped = run({ mode: "list", cursor: 1 }, [christmas], ["ok", "up", "back"]);
  assert.equal(dropped.presets.length, 1);
  assert.deepEqual(dropped.ui, { mode: "list", cursor: 1 });
});

test("switching off and deleting", () => {
  const off = run({ mode: "list", cursor: 0 }, [christmas], ["ok", "up", "ok"]);
  assert.equal(off.presets[0].on, false);
  const kept = run({ mode: "list", cursor: 0 }, [christmas], ["ok", "up", "up", "ok", "back"]);
  assert.equal(kept.presets.length, 1, "Back on the question keeps it");
  const gone = run({ mode: "list", cursor: 0 }, [christmas], ["ok", "up", "up", "ok", "ok"]);
  assert.equal(gone.presets.length, 0);
});

test("the labels setting is the whole list, with no label always offered and a preset's own kept", () => {
  assert.deepEqual(labelChoices(["MUM", "DEMO DAY"], "MUM"), ["MUM", "DEMO DAY", ""]);
  assert.deepEqual(labelChoices([], ""), [""]);
  assert.deepEqual(labelChoices(["MUM"], "OLD NAME"), ["OLD NAME", "MUM", ""]);
  const added = run({ mode: "list", cursor: 1 }, [christmas], ["ok", "start"], ["MUM"]);
  assert.equal(added.presets[1].label, "MUM", "a new preset starts with the first label");
});

test("START in the list or on a preset's actions shows that preset on the countdown", () => {
  const presets = [christmas, { ...christmas, label: "OFF ONE", on: false }];
  const fromList = run({ mode: "list", cursor: 0 }, presets, ["start"]);
  assert.deepEqual([fromList.ui, fromList.show, fromList.announce], [{ mode: "countdown" }, 0, true]);
  const fromActions = run({ mode: "actions", index: 0, cursor: 2 }, presets, ["start"]);
  assert.deepEqual([fromActions.ui, fromActions.show], [{ mode: "countdown" }, 0]);
  for (const cursor of [1, 2]) {
    const plain = run({ mode: "list", cursor }, presets, ["start"]);
    assert.deepEqual([plain.ui, plain.show], [{ mode: "countdown" }, undefined], "off, or + ADD NEW: as it was");
  }
});

test("the moment line shows only what matters, and fits the display", () => {
  const line = (over: Partial<Preset>) => momentParts({ ...christmas, ...over }).map(([p]) => p).join("");
  assert.equal(line({}), "24 DEC 2026 18:00");
  assert.equal(line({ year: null }), "YEARLY 24 DEC 18:00");
  assert.equal(line({ month: null, day: 15 }), "MONTHLY 15 18:00");
  assert.equal(line({ day: WED, hour: 9 }), "EVERY WED 09:00");
  assert.equal(line({ day: EVERY_DAY, hour: 17 }), "DAILY 17:00");
  assert.equal(line({ hour: null, minute: 30 }), "HOURLY :30");
  // Drawn with one-pixel gaps when needed: the widest line still has its ink inside the 72 columns.
  for (const over of [{}, { year: null }, { month: null }]) {
    for (let month = 1; month <= 12; month += 1) {
      const parts = momentParts({ ...christmas, ...over, month, day: 20, hour: 0, minute: 0 });
      const ink = parts.reduce((sum, [p]) => sum + (p === " " ? 1 : textWidth(p, "small")), 0) - 1;
      assert.ok(ink <= 72, `${parts.map(([p]) => p).join("")}: ${ink}`);
    }
  }
});

test("every menu screen stays on the displays", () => {
  const presets = [christmas, { ...christmas, label: "A VERY LONG LABEL THAT DOES NOT FIT", on: false }];
  const screens: Ui[] = [
    { mode: "list", cursor: 0 }, { mode: "list", cursor: 2 }, { mode: "actions", index: 0, cursor: 1 },
    { mode: "actions", index: 1, cursor: 2 }, { mode: "confirm", index: 0 },
    ...FIELDS.map((field) => ({ mode: "edit", index: 0, draft: { ...christmas, year: null }, field, labels: [] }) as Ui),
    { mode: "edit", index: 0, draft: { ...christmas, hour: null }, field: "hour", labels: [] },
  ];
  for (const ui of screens) {
    const elements = menuFrame(ui, presets);
    const ids = elements.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `${ui.mode}: ids are unique`);
    for (const e of elements) {
      const [w, h] = e.display === "back" ? [160, 80] : [72, 16];
      assert.ok((e.x as number) >= 0 && (e.x as number) < w && (e.y as number) > -4 && (e.y as number) < h, `${ui.mode} ${e.id}`);
    }
  }
  const turnOff = menuFrame({ mode: "actions", index: 0, cursor: 1 }, presets).find((e) => e.id === "m_v");
  assert.equal(turnOff?.color, "#FFB020FF", "turning off is amber");
});

test("a new preset starts a week out at noon, once", () => {
  const fresh = newPreset(now, "X");
  assert.deepEqual([fresh.day, fresh.month, fresh.year, fresh.hour, fresh.minute], [29, 11, 2026, 12, 0]);
  assert.equal(ruleOf(fresh), "once");
  assert.equal(presetTarget(fresh, now) - now, 7 * DAY_MS);
});
