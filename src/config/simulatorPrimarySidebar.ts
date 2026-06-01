/**
 * Primary sidebar width tokens for the Simulator (SessionReplay) UIs —
 * CodeEditor, Chat, Browser session replay views, and the DevTools preview.
 *
 * Separate from WORK_STATION_PRIMARY_SIDEBAR so live Workstation (My Station)
 * and replay-mode simulator sidebars can evolve independently.
 */
export const SIMULATOR_PRIMARY_SIDEBAR = {
  defaultWidth: 200,
  minWidth: 200,
  maxWidth: 500,
} as const;
