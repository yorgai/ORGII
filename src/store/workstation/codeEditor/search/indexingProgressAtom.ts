/**
 * Indexing Progress State
 *
 * Global atoms for tracking code search indexing progress.
 * Used by both settings panel and search panel.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export type IndexingStatus =
  | "idle"
  | "scanning"
  | "indexing"
  | "embedding"
  | "ready"
  | "error"
  | "cancelled";

export interface IndexingProgress {
  /** Current status */
  status: IndexingStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Repository being indexed */
  repoId: string | null;
  /** Repository path */
  repoPath: string | null;
  /** Current file being processed */
  currentFile: string | null;
  /** Number of files processed */
  filesProcessed: number;
  /** Total number of files to process */
  filesTotal: number;
  /** Number of chunks embedded */
  chunksEmbedded: number;
  /** Error message if status is 'error' */
  errorMessage: string | null;
  /** Timestamp when indexing started */
  startedAt: number | null;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining: number | null;
}

// ============================================
// Default State
// ============================================

const DEFAULT_PROGRESS: IndexingProgress = {
  status: "idle",
  progress: 0,
  repoId: null,
  repoPath: null,
  currentFile: null,
  filesProcessed: 0,
  filesTotal: 0,
  chunksEmbedded: 0,
  errorMessage: null,
  startedAt: null,
  estimatedTimeRemaining: null,
};

// ============================================
// Atoms
// ============================================

/**
 * Main indexing progress state
 */
export const indexingProgressAtom = atom<IndexingProgress>(DEFAULT_PROGRESS);
indexingProgressAtom.debugLabel = "indexingProgressAtom";

/**
 * Whether any indexing is currently in progress
 */
export const isIndexingAtom = atom((get) => {
  const progress = get(indexingProgressAtom);
  return (
    progress.status === "scanning" ||
    progress.status === "indexing" ||
    progress.status === "embedding"
  );
});
isIndexingAtom.debugLabel = "isIndexingAtom";

/**
 * Progress percentage (0-100)
 */
export const indexingPercentAtom = atom((get) => {
  const progress = get(indexingProgressAtom);
  return progress.progress;
});
indexingPercentAtom.debugLabel = "indexingPercentAtom";

/**
 * Human-readable status message
 */
export const indexingStatusMessageAtom = atom((get) => {
  const progress = get(indexingProgressAtom);

  switch (progress.status) {
    case "idle":
      return null;
    case "scanning":
      return "Scanning files...";
    case "indexing":
      return `Indexing ${progress.filesProcessed}/${progress.filesTotal} files`;
    case "embedding":
      return `Embedding ${progress.chunksEmbedded} chunks`;
    case "ready":
      return "Indexing complete";
    case "error":
      return progress.errorMessage || "Indexing failed";
    case "cancelled":
      return "Indexing cancelled";
    default:
      return null;
  }
});
indexingStatusMessageAtom.debugLabel = "indexingStatusMessageAtom";

// ============================================
// Actions
// ============================================

/**
 * Start indexing a repository
 */
export const startIndexingProgressAtom = atom(
  null,
  (
    get,
    set,
    params: { repoId: string; repoPath: string; filesTotal?: number }
  ) => {
    set(indexingProgressAtom, {
      ...DEFAULT_PROGRESS,
      status: "scanning",
      repoId: params.repoId,
      repoPath: params.repoPath,
      filesTotal: params.filesTotal || 0,
      startedAt: Date.now(),
    });
  }
);

/**
 * Update indexing progress
 */
export const updateIndexingProgressAtom = atom(
  null,
  (
    get,
    set,
    params: {
      filesProcessed?: number;
      filesTotal?: number;
      currentFile?: string;
      chunksEmbedded?: number;
      status?: IndexingStatus;
      progress?: number;
    }
  ) => {
    const current = get(indexingProgressAtom);

    const filesProcessed = params.filesProcessed ?? current.filesProcessed;
    const filesTotal = params.filesTotal ?? current.filesTotal;

    // Use explicit progress if provided, otherwise calculate from files
    const progress =
      params.progress !== undefined
        ? params.progress
        : filesTotal > 0
          ? Math.round((filesProcessed / filesTotal) * 100)
          : 0;

    // Estimate remaining time
    let estimatedTimeRemaining: number | null = null;
    if (
      current.startedAt &&
      filesProcessed > 0 &&
      filesTotal > filesProcessed
    ) {
      const elapsed = Date.now() - current.startedAt;
      const rate = filesProcessed / elapsed; // files per ms
      const remaining = filesTotal - filesProcessed;
      estimatedTimeRemaining = Math.round(remaining / rate);
    }

    set(indexingProgressAtom, {
      ...current,
      status: params.status ?? current.status,
      filesProcessed,
      filesTotal,
      currentFile: params.currentFile ?? current.currentFile,
      chunksEmbedded: params.chunksEmbedded ?? current.chunksEmbedded,
      progress,
      estimatedTimeRemaining,
    });
  }
);

/**
 * Mark indexing as complete
 */
export const completeIndexingAtom = atom(null, (get, set) => {
  const current = get(indexingProgressAtom);
  set(indexingProgressAtom, {
    ...current,
    status: "ready",
    progress: 100,
    currentFile: null,
    estimatedTimeRemaining: null,
  });
});

/**
 * Set indexing error
 */
export const setIndexingErrorAtom = atom(
  null,
  (get, set, errorMessage: string) => {
    const current = get(indexingProgressAtom);
    set(indexingProgressAtom, {
      ...current,
      status: "error",
      errorMessage,
      currentFile: null,
      estimatedTimeRemaining: null,
    });
  }
);

/**
 * Cancel indexing
 */
export const cancelIndexingAtom = atom(null, (get, set) => {
  const current = get(indexingProgressAtom);
  set(indexingProgressAtom, {
    ...current,
    status: "cancelled",
    currentFile: null,
    estimatedTimeRemaining: null,
  });
});

/**
 * Reset to idle state
 */
export const resetIndexingAtom = atom(null, (_get, set) => {
  set(indexingProgressAtom, DEFAULT_PROGRESS);
});
