import { device } from "@shared/device";
import { loadValues } from "@shared/settings";
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS, cleanLabel, parseDuration, type State } from "./countdown.ts";
import { STOCK_LABELS, press, type Key, type Ui } from "./editor.ts";
import { LED_ALERT, buildFrame, messageFrame } from "./frame.ts";
import { menuFrame } from "./menu.ts";
import { createScreen } from "./screen.ts";
import { parsePresets, presetName, presetTarget, serializePresets, type Preset } from "./store.ts";
import manifest from "./appmeta/manifest.json";

const APP = manifest.id;

/** The bar's time zone offset is read again this often, to follow summer time. */
const OFFSET_REFRESH_MS = 30 * MINUTE_MS;
/** How long the label line names the preset the wheel switched to. */
const ANNOUNCE_MS = 1500;
/** The menu returns to the countdown after this long without a key; an unsaved edit is dropped. */
const MENU_IDLE_MS = 60 * 1000;
/** The wheel's choice is stored once it has rested this long, to spare the flash. */
const SAVE_DELAY_MS = 1000;
/** Wake just after a boundary, not just before it. */
const BOUNDARY_SLACK_MS = 5;
const PRESETS_KEY = "presets";
const SHOWN_KEY = "shown";
const CHIME = "shared/sounds/calendar_event_starts.snd";

type Options = { warningMs: number; dangerMs: number; sound: boolean; labels: string[] };

const report = (err: unknown) => console.error(`${APP}: ${err instanceof Error ? err.message : String(err)}`);

/** Time until the next whole `unit` of the clock. The bar's offset is whole minutes, so UTC boundaries are local ones. */
const untilNext = (unit: number) => unit - (Date.now() % unit) + BOUNDARY_SLACK_MS;

/** The bar's offset from UTC in minutes, from its clock ("2026-11-22T14:30:45+01:00"); 0 when unknown. */
async function loadOffsetMin(): Promise<number> {
  try {
    const { timestamp } = await device.TimeGet();
    const m = /([+-])(\d\d):?(\d\d)$/.exec(String(timestamp));
    if (!m) return 0;
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    return m[1] === "-" ? -minutes : minutes;
  } catch (err) {
    report(err);
    return 0;
  }
}

function readOptions(values: Record<string, unknown>): Options {
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : "");
  let warningMs = parseDuration(str("warning")) ?? DAY_MS;
  let dangerMs = parseDuration(str("danger")) ?? HOUR_MS;
  // A danger window wider than the warning one would hide the amber state.
  if (dangerMs > warningMs) [warningMs, dangerMs] = [dangerMs, warningMs];
  // The field is prefilled with the stock labels, so it holds the whole list.
  const labels = typeof values.labels === "string"
    ? values.labels.split(",").map(cleanLabel).filter((l, i, all) => l.length > 0 && all.indexOf(l) === i)
    : STOCK_LABELS;
  return { warningMs, dangerMs, sound: values.sound !== false, labels };
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Each write rewrites the app's store in flash. */
function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    report(err);
  }
}

/**
 * The app stays alive while its input listener does; Back on the countdown releases it and the one timer. The timer
 * wakes only when the screen will change: on the second in the final hour, else on the minute, and in the menu
 * only for its idle timeout.
 */
function main(): void {
  const screen = createScreen(APP, report);

  let options: Options | null = null;
  let presets: Preset[] = [];
  /** Index into `presets` of the one on the countdown. */
  let shown = 0;
  let ui: Ui = { mode: "countdown" };
  let offsetMs = 0;
  let offsetAt = 0;
  let showTarget = false;
  let announceUntil = 0;
  let lastInput = Date.now();
  /** The urgency on show; null when the preset changes, so the change does not blink or chime. */
  let lastState: State | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const localNow = () => Date.now() + offsetMs;
  const activeIndexes = () => presets.flatMap((p, i) => (p.on ? [i] : []));

  function schedule(delayMs: number | null): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = delayMs === null ? undefined : setTimeout(tick, Math.max(0, delayMs));
  }

  function refreshOffset(): void {
    offsetAt = Date.now();
    void loadOffsetMin().then((min) => {
      offsetMs = min * MINUTE_MS;
    });
  }

  /** Points the countdown at `index` and stores it once it rests. */
  function remember(index: number): void {
    shown = index;
    if (saveTimer !== undefined) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      writeStored(SHOWN_KEY, String(shown));
    }, SAVE_DELAY_MS);
  }

  function show(index: number, announce: boolean): void {
    remember(index);
    showTarget = false;
    lastState = null;
    if (announce) announceUntil = Date.now() + ANNOUNCE_MS;
  }

  /** A shown preset that is gone or off gives way to the first one that is on. */
  function keepShownValid(): void {
    const active = activeIndexes();
    if (active.length > 0 && !active.includes(shown)) show(active[0], false);
  }

  /** Draws the countdown and gives the time until it next changes; null when nothing will change without a key. */
  function countdownFrame(): number | null {
    if (!options) return null;
    const preset = presets[shown];
    if (!preset || !preset.on) {
      screen.draw(messageFrame(presets.length ? "ALL OFF" : "NO PRESETS", "OK: MENU"));
      lastState = null;
      return null;
    }
    const now = localNow();
    const announcing = activeIndexes().length > 1 && Date.now() < announceUntil;
    const frame = buildFrame({
      now,
      target: presetTarget(preset, now),
      warningMs: options.warningMs,
      dangerMs: options.dangerMs,
      label: preset.label,
      announce: announcing ? `< ${presetName(preset)} >` : undefined,
      showTarget,
    });
    // Alert on a change of urgency, not on the first frame of a preset.
    let led: string | undefined;
    if (lastState !== null && frame.state !== lastState) {
      led = LED_ALERT[frame.state];
      if (frame.state === "expired" && options.sound) {
        void device.AudioPlay({ application_name: APP, stock_path: CHIME }).catch(report);
      }
    }
    lastState = frame.state;
    screen.draw(frame.elements, led);
    const next = untilNext(frame.perSecond ? SECOND_MS : MINUTE_MS);
    return announcing ? Math.min(next, announceUntil - Date.now() + BOUNDARY_SLACK_MS) : next;
  }

  /** Redraws the current screen and schedules the next wake-up. */
  function tick(): void {
    if (stopped || !options) return;
    const idle = Date.now() - lastInput;
    if (ui.mode !== "countdown" && idle >= MENU_IDLE_MS) ui = { mode: "countdown" };
    if (ui.mode !== "countdown") {
      screen.draw(menuFrame(ui, presets));
      schedule(MENU_IDLE_MS - idle);
      return;
    }
    if (Date.now() - offsetAt > OFFSET_REFRESH_MS) refreshOffset();
    schedule(countdownFrame());
  }

  function quit(): void {
    stopped = true;
    schedule(null);
    if (saveTimer !== undefined) {
      // A choice still waiting to be stored is stored now.
      clearTimeout(saveTimer);
      saveTimer = undefined;
      writeStored(SHOWN_KEY, String(shown));
    }
  }

  /** The wheel steps through the presets that are on, START flips to the date, OK opens the menu. */
  function onCountdown(key: Key): void {
    const active = activeIndexes();
    if ((key === "up" || key === "down") && active.length > 1) {
      const at = Math.max(0, active.indexOf(shown));
      show(active[(at + (key === "up" ? 1 : -1) + active.length) % active.length], true);
    } else if (key === "start") {
      showTarget = !showTarget;
    } else if (key === "ok") {
      ui = { mode: "list", cursor: shown };
    }
  }

  function onMenu(key: Key): void {
    const step = press(ui, presets, key, localNow(), options?.labels ?? STOCK_LABELS);
    ui = step.ui;
    if (step.presets) {
      // Follow the shown preset to its new index when one before it is deleted; a preset that was deleted or changed
      // starts without an alert.
      const kept = step.presets.indexOf(presets[shown]);
      presets = step.presets;
      writeStored(PRESETS_KEY, serializePresets(presets));
      if (kept < 0) lastState = null;
      else if (kept !== shown) remember(kept);
    }
    if (step.show !== undefined) show(step.show, step.announce === true);
    keepShownValid();
  }

  const unbind = listen("input", (event) => {
    if (stopped) return;
    let key: Key | null = null;
    if (event.key === "encoder") key = event.delta > 0 ? "up" : "down";
    else if (event.action === "short") key = event.key;
    if (!key) return;
    lastInput = Date.now();
    if (options && ui.mode !== "countdown") {
      onMenu(key);
    } else if (key === "back") {
      // Back quits even before the settings have loaded. Not detached inside the handler: the app would stop while
      // it still runs.
      quit();
      setTimeout(unbind, 0);
      return;
    } else if (options) {
      onCountdown(key);
    } else {
      return;
    }
    tick();
  });

  offsetAt = Date.now();
  void Promise.all([loadValues(), loadOffsetMin()])
    .then(([values, offsetMin]) => {
      if (stopped) return;
      offsetMs = offsetMin * MINUTE_MS;
      presets = parsePresets(readStored(PRESETS_KEY));
      shown = Number(readStored(SHOWN_KEY)) || 0;
      keepShownValid();
      options = readOptions(values ?? {});
      tick();
    })
    .catch(report);
}

main();
