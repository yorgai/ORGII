/**
 * Session Types
 *
 * Types for session view state management.
 */

// ============================================
// Session View Types
// ============================================

/**
 * Session view state - single session at a time
 */
export interface SessionViewState {
  /** Active session ID (null = no session selected) */
  activeSessionId: string | null;
  /** Session name for display */
  sessionName?: string;
  /** Repo path if session has one */
  repoPath?: string;
}
