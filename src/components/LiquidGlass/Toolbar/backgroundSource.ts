/**
 * BackgroundSource - Single source of truth for the toolbar WebGL background.
 *
 * The renderer can be in exactly one of three states. Modeling this as a
 * discriminated union eliminates the split-brain we used to have where two
 * independent strings (currentBackgroundUrl + currentBackgroundColor) had to
 * stay in sync with a boolean (bgTextureReady).
 */

export type BackgroundSource =
  | { kind: "image"; url: string }
  | { kind: "color"; value: string }
  | { kind: "none" };

/**
 * Structural equality for BackgroundSource. Used by SharedGlassRenderer to
 * dedup setBackground() calls without resorting to per-field string guards.
 */
export function sourceEquals(
  a: BackgroundSource,
  b: BackgroundSource
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "image" && b.kind === "image") return a.url === b.url;
  if (a.kind === "color" && b.kind === "color") return a.value === b.value;
  return true;
}

export const NONE_SOURCE: BackgroundSource = { kind: "none" };
