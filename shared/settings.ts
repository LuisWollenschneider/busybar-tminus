// The app's settings, read from the BUSY Bar's HTTP API: GET /api/apps/settings?app_id=<this app>. The bar answers
// with every field of src/appmeta/settings.json, the saved value or its default. An app cannot write its settings.
import manifest from "../src/appmeta/manifest.json";
import { device } from "./device";

/** The values: field id -> value; a group is a nested map. */
export type SettingsValues = Record<string, unknown>;

/**
 * Reads the app's settings. Null when the app has no src/appmeta/settings.json or the BUSY Bar did not answer: use the
 * defaults in code then.
 */
export async function loadValues(): Promise<SettingsValues | null> {
  try {
    const answer: unknown = await device.AppsSettingsGet({ app_id: manifest.id });
    const values = (answer as { values?: unknown } | null)?.values;
    return values !== null && typeof values === "object" ? (values as SettingsValues) : null;
  } catch {
    return null;
  }
}
