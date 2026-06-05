/**
 * Session In-Progress Detection
 *
 * Determines whether a session should show an "in progress" indicator.
 *
 * The sidebar uses this synchronous helper when building session rows, so it
 * must not require process-level signals that are unavailable for Rust-native
 * / hosted agent sessions. A persisted active/working status from the backend
 * is the source of truth for the row spinner; stale/orphan cleanup belongs in
 * the backend status aggregation path, not in this visual helper.
 */

const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "installing",
  "in_progress",
  "pending",
  "queued",
  "waiting_for_funds",
  "waiting_for_user",
]);

/**
 * Synchronous check whether a session should display as in progress.
 */
export function isSessionInProgress(
  status: string | undefined,
  _session?: { pid?: number | null; updated_at?: string; created_at?: string }
): boolean {
  return status !== undefined && IN_PROGRESS_STATUSES.has(status);
}
