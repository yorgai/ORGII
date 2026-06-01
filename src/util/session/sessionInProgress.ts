/**
 * Session In-Progress Detection
 *
 * Determines whether a session should show an "in progress" indicator.
 *
 * MIGRATION NOTE: The stale detection logic is now also available in Rust
 * via `session_check_health` command. For new code, prefer using
 * `checkSessionHealth()` from `@src/api/tauri/session` which uses centralized
 * thresholds. The synchronous `isSessionInProgress()` below is kept for
 * components that need a local computation without a Tauri call.
 *
 * Thresholds (must match Rust backend):
 * - PENDING_STALE_THRESHOLD_MS: 2 minutes
 * - RUNNING_STALE_THRESHOLD_MS: 5 minutes
 * - ABSOLUTE_STALE_THRESHOLD_MS: 1 hour (catches orphaned sessions with stale pid)
 */

// Thresholds must match Rust backend (src-tauri/src/session/session_aggregate.rs)
const PENDING_STALE_THRESHOLD_MS = 2 * 60 * 1000;
const RUNNING_STALE_THRESHOLD_MS = 5 * 60 * 1000;
const ABSOLUTE_STALE_THRESHOLD_MS = 60 * 60 * 1000;

function getSessionAge(session: {
  updated_at?: string;
  created_at?: string;
}): number | null {
  const timestamp = session.updated_at || session.created_at;
  if (!timestamp) return null;
  return Date.now() - new Date(timestamp).getTime();
}

/**
 * Synchronous check whether a session is in progress.
 *
 * This is a local computation that doesn't require a Tauri call.
 * For the canonical implementation with full health status, use
 * `checkSessionHealth()` from `@src/api/tauri/session` instead.
 */
export function isSessionInProgress(
  status: string | undefined,
  session?: { pid?: number | null; updated_at?: string; created_at?: string }
): boolean {
  if (status === "waiting_for_user") return true;

  if (status === "running") {
    if (session) {
      const age = getSessionAge(session);
      if (age !== null && age > ABSOLUTE_STALE_THRESHOLD_MS) return false;

      const hasPid = session.pid != null;
      if (!hasPid && age !== null && age > RUNNING_STALE_THRESHOLD_MS) {
        return false;
      }
    }
    return true;
  }

  if (status !== "pending") return false;

  if (session) {
    const age = getSessionAge(session);
    if (age !== null && age > ABSOLUTE_STALE_THRESHOLD_MS) return false;

    const hasPid = session.pid != null;
    if (!hasPid && age !== null && age > PENDING_STALE_THRESHOLD_MS) {
      return false;
    }
  }
  return true;
}
