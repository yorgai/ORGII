/**
 * Thread Selector Configuration
 *
 * Constants and configuration for the thread selector.
 */

/**
 * Action types that indicate thread lifecycle
 */
export const THREAD_LIFECYCLE_ACTIONS = {
  start: "session_start",
  end: "session_end",
} as const;

/**
 * Format thread ID for display
 * Converts "implement-html-structure" to "Implement Html Structure"
 */
export function formatThreadDisplayName(threadId: string): string {
  return threadId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
