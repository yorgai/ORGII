/**
 * App Types for Simulator (Agent Apps)
 *
 * NOTE: These IDs should match the IDs in dockConfig.ts and Rust SimulatorApp enum.
 */
export enum AppType {
  CODE_EDITOR = "CODE_EDITOR",
  CHANNELS = "CHANNELS",
  BROWSER = "BROWSER",
  DB_MANAGER = "DB_MANAGER",
  STORY_MANAGER = "STORY_MANAGER",
  DIFF = "DIFF",
  BACKGROUND_TASKS = "BACKGROUND_TASKS",
  CANVAS = "CANVAS",
}

/** Project manager dock app id (same as `AppType.STORY_MANAGER`; use for switch/return where needed). */
export const APP_TYPE_PROJECT: AppType = AppType.STORY_MANAGER;
