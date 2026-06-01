/**
 * Spinner / Loader2 size tokens
 *
 * Unified sizes for loading indicators across the app.
 * - default: 16px for Placeholder loading, detail panels, inline panels, buttons
 * - small: 12px for status bars, badges, compact UI
 */
export const SPINNER_TOKENS = {
  /** Placeholder loading, detail panels, inline panels, Loader2 in content areas */
  default: 16,
  /** Status bar, badges, compact UI elements */
  small: 12,
} as const;
