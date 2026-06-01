/**
 * File Review Atom
 *
 * Tracks the review state of file changes made by the coding agent.
 * Each tool call that modifies a file can be undone or kept.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

type FileReviewStatus = "pending" | "kept" | "undone";

export type FileResolution = "accepted" | "rejected";

interface FileReviewEntry {
  sessionId: string;
  snapshotSessionId: string;
  status: FileReviewStatus;
  snapshotHash: string;
  createdAt: string;
}

export const activeFileReviewSessionIdAtom = atom<string | null>(null);
activeFileReviewSessionIdAtom.debugLabel = "activeFileReviewSessionIdAtom";

/**
 * Map of callId → review state.
 * Entries are scoped to activeFileReviewSessionIdAtom so late async loads from
 * a previous session cannot surface stale Files pills in a newly opened chat.
 */
export const fileReviewMapAtom = atom<Map<string, FileReviewEntry>>(new Map());
fileReviewMapAtom.debugLabel = "fileReviewMapAtom";

/**
 * Workspace path for the current session's file review.
 * Set by useFileReviewSync when loading session data.
 */
export const fileReviewWorkspacePathAtom = atom<string | null>(null);
fileReviewWorkspacePathAtom.debugLabel = "fileReviewWorkspacePathAtom";

export interface RedoSnapshotAnchor {
  sessionId: string;
  snapshotId: string;
  createdAt: string;
}

export const redoSnapshotAnchorAtom = atom<RedoSnapshotAnchor[]>([]);
redoSnapshotAnchorAtom.debugLabel = "redoSnapshotAnchorAtom";

/**
 * Register multiple file changes at once (avoids N re-renders).
 */
export const registerFileChangesBatchAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      sessionId: string;
      entries: Array<{
        callId: string;
        snapshotSessionId: string;
        snapshotHash: string;
        createdAt: string;
      }>;
    }
  ) => {
    const activeSessionId = get(activeFileReviewSessionIdAtom);
    if (activeSessionId !== payload.sessionId) return;

    const current = get(fileReviewMapAtom);
    let next: Map<string, FileReviewEntry> | null = null;
    for (const entry of payload.entries) {
      if (current.has(entry.callId)) continue;
      if (!next) next = new Map(current);
      next.set(entry.callId, {
        sessionId: payload.sessionId,
        snapshotSessionId: entry.snapshotSessionId,
        status: "pending",
        snapshotHash: entry.snapshotHash,
        createdAt: entry.createdAt,
      });
    }
    if (next) {
      set(fileReviewMapAtom, next);
      set(redoSnapshotAnchorAtom, []);
    }
  }
);
registerFileChangesBatchAtom.debugLabel = "registerFileChangesBatchAtom";

/**
 * Incremented when a batch action (Keep All / Undo All) resolves the current
 * review round. useFileReviewSync watches this to reset its snapshot counter
 * so the next round of agent edits can register fresh snapshots.
 */
export const fileReviewResetSignalAtom = atom(0);
fileReviewResetSignalAtom.debugLabel = "fileReviewResetSignalAtom";

/**
 * Mark all pending file changes as kept, then clear the map so the next
 * round of agent edits can register as fresh pending entries.
 */
export const keepAllFileChangesAtom = atom(null, (get, set) => {
  set(fileReviewMapAtom, new Map());
  set(fileReviewResetSignalAtom, get(fileReviewResetSignalAtom) + 1);
});
keepAllFileChangesAtom.debugLabel = "keepAllFileChangesAtom";

/**
 * Mark all pending file changes as undone, then clear the map so the next
 * round of agent edits can register as fresh pending entries.
 * The actual revert call must happen in the hook before dispatching this.
 */
export const undoAllFileChangesAtom = atom(null, (get, set) => {
  set(fileReviewMapAtom, new Map());
  set(fileReviewResetSignalAtom, get(fileReviewResetSignalAtom) + 1);
});
undoAllFileChangesAtom.debugLabel = "undoAllFileChangesAtom";

/**
 * Derived: count of pending reviews.
 */
export const pendingReviewCountAtom = atom((get) => {
  const activeSessionId = get(activeFileReviewSessionIdAtom);
  const map = get(fileReviewMapAtom);
  let pending = 0;
  for (const entry of map.values()) {
    if (entry.sessionId === activeSessionId && entry.status === "pending") {
      pending++;
    }
  }
  return pending;
});
pendingReviewCountAtom.debugLabel = "pendingReviewCountAtom";

/**
 * Derived: the earliest pending snapshot, as { hash, createdAt }.
 * `hash` is used for per-file revert; `createdAt` is passed to
 * agent_revert so the backend can walk ALL snapshots from that point
 * forward via rewind_to_message.
 */
export interface PendingSnapshotAnchor {
  sessionId: string;
  hash: string;
  createdAt: string;
}

export const pendingSnapshotAnchorsAtom = atom(
  (get): PendingSnapshotAnchor[] => {
    const activeSessionId = get(activeFileReviewSessionIdAtom);
    const map = get(fileReviewMapAtom);
    const anchors: PendingSnapshotAnchor[] = [];
    for (const entry of map.values()) {
      if (entry.sessionId !== activeSessionId || entry.status !== "pending") {
        continue;
      }
      anchors.push({
        sessionId: entry.snapshotSessionId,
        hash: entry.snapshotHash,
        createdAt: entry.createdAt,
      });
    }
    return anchors.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
  }
);
pendingSnapshotAnchorsAtom.debugLabel = "pendingSnapshotAnchorsAtom";

export const earliestPendingSnapshotAtom = atom((get) => {
  return get(pendingSnapshotAnchorsAtom)[0] ?? null;
});
earliestPendingSnapshotAtom.debugLabel = "earliestPendingSnapshotAtom";

/**
 * Per-file resolution state (path → accepted/rejected).
 * Survives component unmount; cleared on session switch.
 */
export const resolvedFilePathsAtom = atom<Map<string, FileResolution>>(
  new Map()
);
resolvedFilePathsAtom.debugLabel = "resolvedFilePathsAtom";

/**
 * Resolve a single file (accept or reject).
 */
export const resolveFileAtom = atom(
  null,
  (get, set, payload: { path: string; resolution: FileResolution }) => {
    const current = get(resolvedFilePathsAtom);
    const next = new Map(current);
    next.set(payload.path, payload.resolution);
    set(resolvedFilePathsAtom, next);
  }
);
resolveFileAtom.debugLabel = "resolveFileAtom";

/**
 * Batch-restore persisted file resolutions (avoids N re-renders).
 */
export const restoreFileResolutionsAtom = atom(
  null,
  (_get, set, entries: Array<{ path: string; resolution: FileResolution }>) => {
    if (entries.length === 0) return;
    const next = new Map<string, FileResolution>();
    for (const entry of entries) {
      next.set(entry.path, entry.resolution);
    }
    set(resolvedFilePathsAtom, next);
  }
);
restoreFileResolutionsAtom.debugLabel = "restoreFileResolutionsAtom";

/**
 * Clear all review state (on session switch).
 */
export const clearFileReviewAtom = atom(
  null,
  (_get, set, sessionId?: string) => {
    set(activeFileReviewSessionIdAtom, sessionId ?? null);
    set(fileReviewMapAtom, new Map());
    set(fileReviewWorkspacePathAtom, null);
    set(resolvedFilePathsAtom, new Map());
    set(redoSnapshotAnchorAtom, []);
  }
);
clearFileReviewAtom.debugLabel = "clearFileReviewAtom";
