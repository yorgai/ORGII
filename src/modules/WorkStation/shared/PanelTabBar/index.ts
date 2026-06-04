/**
 * Shared chrome for the Workstation "secondary panel" slot — the single
 * panel that lives on the right rail or at the bottom of
 * `WorkStationShell` (Browser DevTools, Code Editor output, etc.).
 *
 * - `Header` — position-aware tab header (TabPill on bottom, TabBar on
 *   right) with slots for per-tab actions + persistent controls.
 * - `PositionToggle` — small button that flips the panel between right
 *   and bottom; drop it into the header's `persistentActions` slot.
 *
 * The panel's config type + builder stay in `WorkStationShell/config`
 * since they're part of the shell's prop surface.
 */
export { default as SecondaryPanelHeader } from "./Header";
export type {
  SecondaryPanelHeaderProps,
  SecondaryPanelHeaderTab,
} from "./Header";

export { PanelPositionToggle } from "./PositionToggle";
