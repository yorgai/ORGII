/**
 * Canvas replay helpers (UI lives under `Canvas/index.tsx`).
 *
 * Canvas is not a separate Simulator `AppType`; events route to Channels (`MESSAGES`)
 * and SessionReplay Messages renders the Canvas surface when the current event matches.
 *
 * NOTE: `render_canvas` tool has been archived (2026-03-30). See src-tauri/.archive/canvas/
 */
const CANVAS_EXACT_NAMES = new Set([
  // ARCHIVED (2026-03-30): "render_canvas",
  "control_orgii",
  "manage_nodes",
]);

/**
 * Whether this tool/function name should show the Canvas replay UI inside the Channels
 * (Messages) simulator app.
 */
export function matchesCanvasEvent(eventFunction: string): boolean {
  const lower = eventFunction.toLowerCase();
  return lower.startsWith("canvas") || CANVAS_EXACT_NAMES.has(lower);
}
