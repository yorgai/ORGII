/**
 * Background configuration constants and utilities shared across the store
 * layer (uiAtom, backgroundInit) and the Settings BackgroundPage UI.
 *
 * Lives here so that shared atoms in src/store/ do not need to import from
 * a Settings sub-page module.
 */
import BambooBlueBg from "@src/assets/bg/bamboo-blue.jpg";

// ─── Constants ───────────────────────────────────────────────────────────────

/** localStorage key that holds the legacy single custom picker colour. */
export const CUSTOM_COLOR_STORAGE_KEY = "orgii_custom_bg_color";

/** Bundled image used as `imageUrl` seed in the default background config. */
export const DEFAULT_BUNDLED_BACKGROUND_IMAGE = BambooBlueBg;

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Normalize #rgb / #rrggbb to lowercase #rrggbb. Returns null for invalid input. */
export function normalizeHexColor(input: string): string | null {
  const trimmed = input.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) return null;
  const body = match[1];
  const expanded =
    body.length === 3
      ? body
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : body;
  return `#${expanded.toLowerCase()}`;
}

/** Dedupe while preserving order. Filters out non-strings and invalid hex values. */
export function sanitizeCustomColorsArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const normalized = normalizeHexColor(entry);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Build the DIY colour palette from the stored array, legacy picker key, and
 * the active custom hex. Used by uiAtom during initial hydration to migrate
 * users who had a colour stored under the legacy CUSTOM_COLOR_STORAGE_KEY.
 */
export function mergeStoredCustomColors(params: {
  parsedCustomColors: unknown;
  backgroundColor: unknown;
  backgroundColorId: unknown;
  legacyPickerHex: string | null;
}): string[] {
  const list = sanitizeCustomColorsArray(params.parsedCustomColors);
  const push = (hex: string | null) => {
    if (!hex || list.includes(hex)) return;
    list.push(hex);
  };
  const legacyNorm = params.legacyPickerHex
    ? normalizeHexColor(params.legacyPickerHex)
    : null;
  push(legacyNorm);
  if (!params.backgroundColorId && typeof params.backgroundColor === "string") {
    push(normalizeHexColor(params.backgroundColor));
  }
  return list;
}
