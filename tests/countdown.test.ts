import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DAY_MS, HOUR_MS, MINUTE_MS, calendarSplit, cleanLabel, formatGap, formatTarget, localMs, parseDuration, stateFor,
} from "../src/countdown.ts";
import { buildFrame } from "../src/frame.ts";

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => localMs(y, mo, d, h, mi, s) as number;

test("impossible calendar dates are refused", () => {
  assert.equal(localMs(2026, 4, 31), null);
  assert.equal(localMs(2027, 2, 29), null);
  assert.equal(localMs(2028, 2, 29), Date.UTC(2028, 1, 29));
});

test("the gap gets more precise as the moment comes closer", () => {
  const now = at(2026, 11, 22, 12);
  assert.equal(formatGap(now, now + 5 * MINUTE_MS + 42_000, false).text, "05:42");
  assert.equal(formatGap(now, now + 5 * HOUR_MS + 3 * MINUTE_MS, false).text, "5h 03m");
  assert.equal(formatGap(now, now + 2 * DAY_MS + 7 * HOUR_MS, false).text, "2d 7h");
  assert.equal(formatGap(now, now + 12 * DAY_MS, false).text, "in 12 days");
  assert.equal(formatGap(now, at(2027, 2, 26, 12), false).text, "3mo 4d");
  assert.equal(formatGap(now, at(2028, 1, 22, 12), false).text, "1y 2mo");
  assert.equal(formatGap(now, now + 90_000, true).text, "+01:30");
});

test("calendar months follow the calendar, not 30-day blocks", () => {
  assert.deepEqual(calendarSplit(at(2026, 1, 31), at(2026, 3, 1)), [1, DAY_MS]);
  assert.deepEqual(calendarSplit(at(2026, 3, 15), at(2026, 3, 20)), [0, 5 * DAY_MS]);
});

test("the state follows the thresholds", () => {
  assert.equal(stateFor(2 * DAY_MS, DAY_MS, HOUR_MS), "calm");
  assert.equal(stateFor(DAY_MS, DAY_MS, HOUR_MS), "warning");
  assert.equal(stateFor(HOUR_MS, DAY_MS, HOUR_MS), "danger");
  assert.equal(stateFor(0, DAY_MS, HOUR_MS), "expired");
});

test("durations, labels and the target view", () => {
  assert.equal(parseDuration("2w"), 14 * DAY_MS);
  assert.equal(parseDuration("soon"), null);
  assert.equal(cleanLabel(" Café launch "), "CAF. LAUNCH");
  assert.deepEqual(formatTarget(at(2026, 12, 31, 23, 59)), ["THU 31 DEC 2026", "23:59"]);
});

test("frames stay on the displays and drop the label in the final hour", () => {
  const now = at(2026, 12, 31, 23, 30);
  const base = { now, warningMs: DAY_MS, dangerMs: HOUR_MS, label: "NEW YEAR", showTarget: false };
  for (const target of [now + 30 * MINUTE_MS, now + 3 * HOUR_MS, now + 40 * DAY_MS, now + 800 * DAY_MS, now - 5000]) {
    const { elements } = buildFrame({ ...base, target });
    const ids = elements.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "ids are unique");
    for (const e of elements) {
      const [w, h] = e.display === "back" ? [160, 80] : [72, 16];
      assert.ok((e.x as number) >= 0 && (e.x as number) < w, `${e.id} x inside the display`);
      assert.ok((e.y as number) > -4 && (e.y as number) < h, `${e.id} y inside the display`);
    }
  }
  const final = buildFrame({ ...base, target: now + 30 * MINUTE_MS });
  assert.equal(final.state, "danger");
  assert.ok(!final.elements.some((e) => e.id === "label"));
  const far = buildFrame({ ...base, target: now + 40 * DAY_MS });
  assert.ok(far.elements.some((e) => e.id === "label" && e.text === "NEW YEAR"));
  assert.equal(buildFrame({ ...base, target: now - 5000 }).state, "expired");
});

test("frames change every second only while the seconds show, and beat only then in red", () => {
  const now = at(2026, 12, 31, 12);
  const base = { warningMs: DAY_MS, dangerMs: HOUR_MS, label: "X", showTarget: false };
  const frame = (offset: number, target: number) => buildFrame({ ...base, now: now + offset, target });
  const color = (offset: number, target: number) => frame(offset, target).elements.find((e) => e.id === "v0")?.color;
  assert.equal(frame(0, now + 30 * MINUTE_MS).perSecond, true, "final hour");
  assert.equal(frame(0, now - 30 * MINUTE_MS).perSecond, true, "first hour past zero");
  assert.equal(frame(0, now + 3 * HOUR_MS).perSecond, false);
  assert.equal(frame(0, now - 3 * HOUR_MS).perSecond, false);
  assert.notEqual(color(0, now + 30 * MINUTE_MS), color(1000, now + 30 * MINUTE_MS), "beats in the final hour");
  assert.equal(color(0, now + 3 * HOUR_MS), color(1000, now + 3 * HOUR_MS), "still outside it");
});
