/**
 * Centralized Storage Key Registry
 *
 * Keys referenced by usePersistedState consumers.
 * Only add keys here when they have an actual caller.
 */

export const STORAGE_KEYS = {
  /** User identity & display */
  user: {
    timezoneDisplayName: "timezone_display_name",
  },
} as const;
