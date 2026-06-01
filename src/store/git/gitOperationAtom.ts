/**
 * Git Operation Atom
 *
 * Stores the latest git operation detected by the backend.
 * Used to broadcast operations to Output panel and other consumers.
 *
 * Flow:
 * 1. Rust backend detects git operation (commit, push, pull, etc.)
 * 2. Emits repo:git_operation WebSocket event
 * 3. GitStatusContext receives event and writes to this atom
 * 4. useGitOutputIntegration subscribes and logs to Output panel
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface GitOperation {
  /** Unique ID for deduplication */
  id: string;
  /** Repository ID */
  repoId: string;
  /** Operation type: commit, push, pull, fetch, merge, rebase, checkout, conflict */
  operation: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Human-readable summary */
  summary: string;
  /** Additional details */
  details: string;
  /** Timestamp from backend */
  timestamp: number;
}

// ============================================
// Atoms
// ============================================

/**
 * Latest git operation - consumers can subscribe to this to react to operations.
 * Each new operation replaces the previous one.
 */
export const gitOperationAtom = atom<GitOperation | null>(null);

// ============================================
// Operation History (used by Inbox)
// ============================================

const MAX_OPERATION_HISTORY = 50;

/**
 * Accumulated git operation history for the inbox.
 * Newest operations are prepended. Capped at MAX_OPERATION_HISTORY.
 */
export const gitOperationHistoryAtom = atom<GitOperation[]>([]);
gitOperationHistoryAtom.debugLabel = "gitOperationHistoryAtom";

/**
 * Action atom to set a new git operation.
 * Automatically generates an ID for deduplication.
 * Also appends to the history atom for inbox consumption.
 */
export const setGitOperationAtom = atom(
  null,
  (get, set, operation: Omit<GitOperation, "id"> | null) => {
    if (operation === null) {
      set(gitOperationAtom, null);
      return;
    }

    // Generate unique ID from timestamp + operation type
    const id = `${operation.repoId}-${operation.operation}-${operation.timestamp}`;
    const fullOperation: GitOperation = { ...operation, id };

    set(gitOperationAtom, fullOperation);

    // Append to history (prepend newest, cap at max)
    const history = get(gitOperationHistoryAtom);
    // Deduplicate by id
    if (!history.some((entry) => entry.id === id)) {
      const updated = [fullOperation, ...history];
      set(
        gitOperationHistoryAtom,
        updated.length > MAX_OPERATION_HISTORY
          ? updated.slice(0, MAX_OPERATION_HISTORY)
          : updated
      );
    }
  }
);
