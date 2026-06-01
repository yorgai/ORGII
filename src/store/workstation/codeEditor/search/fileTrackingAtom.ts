/**
 * File Tracking Atom for Incremental Indexing
 *
 * Tracks which files have been indexed and their modification timestamps.
 * Used to determine which files need re-indexing after changes.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export interface TrackedFile {
  /** Relative file path */
  path: string;
  /** File last modified timestamp (ms since epoch) */
  lastModified: number;
  /** When the file was last indexed (ms since epoch) */
  lastIndexed: number;
  /** Optional content hash for change verification */
  contentHash?: string;
}

export interface FileTrackingState {
  /** Map of file path to tracked file info */
  files: Map<string, TrackedFile>;
  /** Timestamp of last full index */
  lastFullIndex: number;
  /** Repository ID this tracking belongs to */
  repoId: string;
}

export interface DirtyFile {
  /** Relative file path */
  path: string;
  /** Type of change */
  changeType: "modify" | "create" | "delete";
  /** When the file was marked dirty */
  markedAt: number;
}

export interface IncrementalIndexResult {
  /** Number of files successfully updated */
  filesUpdated: number;
  /** Number of files that failed to index */
  filesFailed: number;
  /** Paths of failed files */
  failedPaths: string[];
  /** Duration of the operation (ms) */
  durationMs: number;
}

// ============================================
// Constants
// ============================================

/** Debounce delay before triggering re-index (ms) */
export const REINDEX_DEBOUNCE_MS = 2000;

/** Maximum number of files to batch in one incremental index */
export const MAX_BATCH_SIZE = 100;

/** Minimum time between incremental index operations (ms) */
export const MIN_REINDEX_INTERVAL_MS = 5000;

/**
 * Maximum number of repositories to track file state for.
 * PERFORMANCE: Prevents unbounded memory growth in long-running sessions.
 * When exceeded, oldest repo (by lastFullIndex) is evicted.
 */
export const MAX_TRACKED_REPOS = 10;

// ============================================
// Atoms
// ============================================

/**
 * Main file tracking state per repository
 * Key: repoId, Value: FileTrackingState
 */
export const fileTrackingMapAtom = atom<Map<string, FileTrackingState>>(
  new Map()
);
fileTrackingMapAtom.debugLabel = "fileTrackingMapAtom";

/**
 * Set of files marked as "dirty" (need re-indexing)
 * Key: repoId, Value: Map<filePath, DirtyFile>
 */
export const dirtyFilesMapAtom = atom<Map<string, Map<string, DirtyFile>>>(
  new Map()
);
dirtyFilesMapAtom.debugLabel = "dirtyFilesMapAtom";

/**
 * Timestamp of last incremental index per repository
 */
export const lastIncrementalIndexAtom = atom<Map<string, number>>(new Map());
lastIncrementalIndexAtom.debugLabel = "lastIncrementalIndexAtom";

/**
 * Whether incremental indexing is in progress per repository
 */
export const isIncrementalIndexingAtom = atom<Map<string, boolean>>(new Map());
isIncrementalIndexingAtom.debugLabel = "isIncrementalIndexingAtom";

// ============================================
// Derived Atoms
// ============================================

/**
 * Get file tracking state for a specific repository
 */
export const getFileTrackingAtom = atom((get) => (repoId: string) => {
  const map = get(fileTrackingMapAtom);
  return map.get(repoId) || null;
});

/**
 * Get dirty files for a specific repository
 */
export const getDirtyFilesAtom = atom((get) => (repoId: string) => {
  const map = get(dirtyFilesMapAtom);
  const dirtyMap = map.get(repoId);
  return dirtyMap ? Array.from(dirtyMap.values()) : [];
});

/**
 * Get count of dirty files for a specific repository
 */
export const getDirtyFileCountAtom = atom((get) => (repoId: string) => {
  const map = get(dirtyFilesMapAtom);
  const dirtyMap = map.get(repoId);
  return dirtyMap ? dirtyMap.size : 0;
});

/**
 * Check if a specific file needs re-indexing
 */
export const isFileDirtyAtom = atom(
  (get) => (repoId: string, filePath: string) => {
    const map = get(dirtyFilesMapAtom);
    const dirtyMap = map.get(repoId);
    return dirtyMap ? dirtyMap.has(filePath) : false;
  }
);

/**
 * Check if incremental indexing is available (not currently running)
 */
export const canIncrementalIndexAtom = atom((get) => (repoId: string) => {
  const isIndexing = get(isIncrementalIndexingAtom).get(repoId) || false;
  if (isIndexing) return false;

  const lastIndex = get(lastIncrementalIndexAtom).get(repoId) || 0;
  const timeSinceLastIndex = Date.now() - lastIndex;
  return timeSinceLastIndex >= MIN_REINDEX_INTERVAL_MS;
});

// ============================================
// Action Atoms
// ============================================

/**
 * Evict oldest repository from tracking maps (LRU eviction).
 * Called when MAX_TRACKED_REPOS is exceeded.
 */
function evictOldestRepo(
  trackingMap: Map<string, FileTrackingState>,
  dirtyMap: Map<string, Map<string, DirtyFile>>,
  lastIndexMap: Map<string, number>,
  indexingMap: Map<string, boolean>
): {
  trackingMap: Map<string, FileTrackingState>;
  dirtyMap: Map<string, Map<string, DirtyFile>>;
  lastIndexMap: Map<string, number>;
  indexingMap: Map<string, boolean>;
} {
  // Find repo with oldest lastFullIndex
  let oldestRepoId: string | null = null;
  let oldestTimestamp = Infinity;

  for (const [repoId, state] of trackingMap) {
    if (state.lastFullIndex < oldestTimestamp) {
      oldestTimestamp = state.lastFullIndex;
      oldestRepoId = repoId;
    }
  }

  if (oldestRepoId) {
    trackingMap.delete(oldestRepoId);
    dirtyMap.delete(oldestRepoId);
    lastIndexMap.delete(oldestRepoId);
    indexingMap.delete(oldestRepoId);
  }

  return { trackingMap, dirtyMap, lastIndexMap, indexingMap };
}

/**
 * Initialize file tracking for a repository after full index
 */
export const initFileTrackingAtom = atom(
  null,
  (
    get,
    set,
    params: {
      repoId: string;
      files: Array<{ path: string; lastModified: number }>;
    }
  ) => {
    const { repoId, files } = params;
    const now = Date.now();

    const trackedFiles = new Map<string, TrackedFile>();
    for (const file of files) {
      trackedFiles.set(file.path, {
        path: file.path,
        lastModified: file.lastModified,
        lastIndexed: now,
      });
    }

    const state: FileTrackingState = {
      files: trackedFiles,
      lastFullIndex: now,
      repoId,
    };

    let trackingMap = new Map(get(fileTrackingMapAtom));
    let dirtyMap = new Map(get(dirtyFilesMapAtom));
    let lastIndexMap = new Map(get(lastIncrementalIndexAtom));
    let indexingMap = new Map(get(isIncrementalIndexingAtom));

    // LRU eviction: if we're adding a new repo and at capacity, evict oldest
    if (!trackingMap.has(repoId) && trackingMap.size >= MAX_TRACKED_REPOS) {
      const evicted = evictOldestRepo(
        trackingMap,
        dirtyMap,
        lastIndexMap,
        indexingMap
      );
      trackingMap = evicted.trackingMap;
      dirtyMap = evicted.dirtyMap;
      lastIndexMap = evicted.lastIndexMap;
      indexingMap = evicted.indexingMap;

      // Commit eviction changes
      set(lastIncrementalIndexAtom, lastIndexMap);
      set(isIncrementalIndexingAtom, indexingMap);
    }

    trackingMap.set(repoId, state);
    set(fileTrackingMapAtom, trackingMap);

    // Clear any dirty files for this repo
    dirtyMap.delete(repoId);
    set(dirtyFilesMapAtom, dirtyMap);
  }
);

/**
 * Mark a file as dirty (needs re-indexing)
 */
export const markFileDirtyAtom = atom(
  null,
  (
    get,
    set,
    params: {
      repoId: string;
      filePath: string;
      changeType: "modify" | "create" | "delete";
    }
  ) => {
    const { repoId, filePath, changeType } = params;
    const now = Date.now();

    const dirtyMap = new Map(get(dirtyFilesMapAtom));
    const repoDirtyFiles = dirtyMap.get(repoId) || new Map();

    repoDirtyFiles.set(filePath, {
      path: filePath,
      changeType,
      markedAt: now,
    });

    dirtyMap.set(repoId, repoDirtyFiles);
    set(dirtyFilesMapAtom, dirtyMap);
  }
);

/**
 * Mark multiple files as dirty
 */
export const markFilesDirtyAtom = atom(
  null,
  (
    get,
    set,
    params: {
      repoId: string;
      files: Array<{
        path: string;
        changeType: "modify" | "create" | "delete";
      }>;
    }
  ) => {
    const { repoId, files } = params;
    const now = Date.now();

    const dirtyMap = new Map(get(dirtyFilesMapAtom));
    const repoDirtyFiles = new Map(dirtyMap.get(repoId) || new Map());

    for (const file of files) {
      repoDirtyFiles.set(file.path, {
        path: file.path,
        changeType: file.changeType,
        markedAt: now,
      });
    }

    dirtyMap.set(repoId, repoDirtyFiles);
    set(dirtyFilesMapAtom, dirtyMap);
  }
);

/**
 * Clear dirty status for files after successful re-indexing
 */
export const clearDirtyFilesAtom = atom(
  null,
  (
    get,
    set,
    params: {
      repoId: string;
      filePaths: string[];
    }
  ) => {
    const { repoId, filePaths } = params;

    const dirtyMap = new Map(get(dirtyFilesMapAtom));
    const repoDirtyFiles = dirtyMap.get(repoId);

    if (repoDirtyFiles) {
      const updated = new Map(repoDirtyFiles);
      for (const path of filePaths) {
        updated.delete(path);
      }
      dirtyMap.set(repoId, updated);
      set(dirtyFilesMapAtom, dirtyMap);
    }
  }
);

/**
 * Clear all dirty files for a repository
 */
export const clearAllDirtyFilesAtom = atom(null, (get, set, repoId: string) => {
  const dirtyMap = new Map(get(dirtyFilesMapAtom));
  dirtyMap.delete(repoId);
  set(dirtyFilesMapAtom, dirtyMap);
});

/**
 * Update file tracking after incremental index
 */
export const updateFileTrackingAtom = atom(
  null,
  (
    get,
    set,
    params: {
      repoId: string;
      indexedFiles: Array<{ path: string; lastModified: number }>;
      deletedFiles: string[];
    }
  ) => {
    const { repoId, indexedFiles, deletedFiles } = params;
    const now = Date.now();

    const trackingMap = new Map(get(fileTrackingMapAtom));
    const state = trackingMap.get(repoId);

    if (!state) {
      // No tracking state exists - initialize it
      const files = new Map<string, TrackedFile>();
      for (const file of indexedFiles) {
        files.set(file.path, {
          path: file.path,
          lastModified: file.lastModified,
          lastIndexed: now,
        });
      }
      trackingMap.set(repoId, {
        files,
        lastFullIndex: now,
        repoId,
      });
    } else {
      // Update existing state
      const updatedFiles = new Map(state.files);

      // Update indexed files
      for (const file of indexedFiles) {
        updatedFiles.set(file.path, {
          path: file.path,
          lastModified: file.lastModified,
          lastIndexed: now,
        });
      }

      // Remove deleted files
      for (const path of deletedFiles) {
        updatedFiles.delete(path);
      }

      trackingMap.set(repoId, {
        ...state,
        files: updatedFiles,
      });
    }

    set(fileTrackingMapAtom, trackingMap);

    // Update last incremental index timestamp
    const lastIndexMap = new Map(get(lastIncrementalIndexAtom));
    lastIndexMap.set(repoId, now);
    set(lastIncrementalIndexAtom, lastIndexMap);
  }
);

/**
 * Set incremental indexing status
 */
export const setIncrementalIndexingAtom = atom(
  null,
  (get, set, params: { repoId: string; isIndexing: boolean }) => {
    const { repoId, isIndexing } = params;
    const map = new Map(get(isIncrementalIndexingAtom));
    map.set(repoId, isIndexing);
    set(isIncrementalIndexingAtom, map);
  }
);

/**
 * Clear all file tracking data for a repository
 */
export const clearFileTrackingAtom = atom(null, (get, set, repoId: string) => {
  // Clear tracking state
  const trackingMap = new Map(get(fileTrackingMapAtom));
  trackingMap.delete(repoId);
  set(fileTrackingMapAtom, trackingMap);

  // Clear dirty files
  const dirtyMap = new Map(get(dirtyFilesMapAtom));
  dirtyMap.delete(repoId);
  set(dirtyFilesMapAtom, dirtyMap);

  // Clear last index timestamp
  const lastIndexMap = new Map(get(lastIncrementalIndexAtom));
  lastIndexMap.delete(repoId);
  set(lastIncrementalIndexAtom, lastIndexMap);

  // Clear indexing status
  const indexingMap = new Map(get(isIncrementalIndexingAtom));
  indexingMap.delete(repoId);
  set(isIncrementalIndexingAtom, indexingMap);
});
