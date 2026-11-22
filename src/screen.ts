import { device } from "@shared/device";
import type { Element } from "./frame.ts";

/**
 * Sends frames to the displays, only the elements that changed since the last one, and clears the ids a frame no
 * longer has. One request is in flight at a time; a frame asked for meanwhile replaces the one waiting, so a slow
 * bar drops frames instead of queueing them.
 */
export function createScreen(app: string, report: (err: unknown) => void) {
  /** Element id → its JSON as last sent; null while unknown (at the start, or after a failed request). */
  let shown: Map<string, string> | null = null;
  let busy = false;
  let pending: { elements: Element[]; led?: string } | null = null;

  async function send(elements: Element[], led: string | undefined): Promise<void> {
    const before = shown;
    shown = null;
    let changed = elements;
    if (before) {
      const ids = new Set(elements.map((e) => e.id));
      const gone = [...before.keys()].filter((id) => !ids.has(id));
      if (gone.length > 0) await device.DisplayClear({ application_name: app, element_ids: gone });
      changed = elements.filter((e) => before.get(e.id) !== JSON.stringify(e));
    } else {
      await device.DisplayClear({ application_name: app });
    }
    // The LED blink rides on a draw request, so a blink with nothing changed still sends one element.
    if (changed.length === 0 && led && elements.length > 0) changed = [elements[0]];
    if (changed.length > 0) {
      // busy-lib's element types are stricter about optional fields than the firmware; these follow the firmware.
      await device.DisplayDraw({ application_name: app, priority: 50, led_notification_color: led, elements: changed } as never);
    }
    shown = new Map(elements.map((e): [string, string] => [e.id, JSON.stringify(e)]));
  }

  return {
    /** Shows exactly these elements; `led` ("#RRGGBBAA") blinks the status light once. Errors go to `report`. */
    draw(elements: Element[], led?: string): void {
      pending = { elements, led: led ?? pending?.led };
      if (busy) return;
      busy = true;
      void (async () => {
        while (pending) {
          const frame = pending;
          pending = null;
          await send(frame.elements, frame.led).catch(report);
        }
        busy = false;
      })();
    },
  };
}
