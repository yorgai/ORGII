/**
 * Flow Awareness configuration constants.
 *
 * This module contains all configuration values used by the flow awareness system,
 * making them easily adjustable and providing a single source of truth.
 */

/** Performance and batching configuration for flow awareness tracking. */
export const FLOW_AWARENESS_CONFIG = {
  /** Minimum interval between duplicate activities to prevent spam (ms). */
  DEBOUNCE_INTERVAL_MS: 500,

  /** Maximum pending activities before immediate flush to backend. */
  MAX_PENDING_ACTIVITIES: 10,

  /** Regular flush interval for batched activities (ms). */
  FLUSH_INTERVAL_MS: 2000,

  /** Maximum activities in a single Tauri command call to avoid IPC limits. */
  MAX_BATCH_SIZE: 50,

  /** Default maximum activities for context queries. */
  DEFAULT_MAX_ACTIVITIES: 20,

  /** Maximum preview length for clipboard content (characters). */
  MAX_PREVIEW_LENGTH: 200,

  /** Timeout for Tauri command calls (ms). */
  COMMAND_TIMEOUT_MS: 5000,

  /** Enable detailed logging for debugging purposes. */
  DEBUG_LOGGING: process.env.NODE_ENV === "development",
} as const;

/** Activity type mappings for better type safety. */
export const ACTIVITY_TYPES = {
  FILE_EDIT: "file_edit",
  FILE_OPEN: "file_open",
  TERMINAL_COMMAND: "terminal_command",
  SEARCH: "search",
  CLIPBOARD: "clipboard",
  GIT_OPERATION: "git_operation",
  NAVIGATION: "navigation",
  ERROR: "error",
  DEBUG: "debug",
} as const;

/** Search scope mappings for consistent usage. */
export const SEARCH_SCOPES = {
  CODEBASE: "codebase",
  CURRENT_FILE: "current_file",
  FILES: "files",
} as const;

/** Error type mappings for consistent error categorization. */
export const ERROR_TYPES = {
  BUILD: "build",
  TEST: "test",
  LINT: "lint",
  TYPE_CHECK: "type_check",
  RUNTIME: "runtime",
} as const;
