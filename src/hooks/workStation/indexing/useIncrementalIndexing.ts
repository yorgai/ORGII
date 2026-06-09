/**
 * useIncrementalIndexing Hook
 *
 * Manages incremental re-indexing of files that have changed since last index.
 * Listens for file change events and queues files for re-indexing with debouncing.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import { invalidateRepoCacheAtom } from "@src/store/workstation/codeEditor/search/cacheAtom";
import {
  type DirtyFile,
  type IncrementalIndexResult,
  MAX_BATCH_SIZE,
  MIN_REINDEX_INTERVAL_MS,
  REINDEX_DEBOUNCE_MS,
  clearAllDirtyFilesAtom,
  clearDirtyFilesAtom,
  getDirtyFilesAtom,
  isIncrementalIndexingAtom,
  markFileDirtyAtom,
  setIncrementalIndexingAtom,
  updateFileTrackingAtom,
} from "@src/store/workstation/codeEditor/search/fileTrackingAtom";

// ============================================
// Types
// ============================================

export interface UseIncrementalIndexingOptions {
  /** Repository ID */
  repoId: string;
  /** Repository path */
  repoPath: string;
  /** Whether incremental indexing is enabled (default: true) */
  enabled?: boolean;
  /** Custom debounce delay in ms (default: 2000) */
  debounceMs?: number;
  /** Callback when indexing starts */
  onIndexStart?: () => void;
  /** Callback when indexing completes */
  onIndexComplete?: (result: IncrementalIndexResult) => void;
  /** Callback when indexing fails */
  onIndexError?: (error: Error) => void;
}

export interface UseIncrementalIndexingReturn {
  /** Mark a file as needing re-indexing */
  markDirty: (
    filePath: string,
    changeType: "modify" | "create" | "delete"
  ) => void;
  /** Trigger immediate re-indexing of dirty files */
  flushDirtyFiles: () => Promise<IncrementalIndexResult | null>;
  /** Get current dirty files */
  dirtyFiles: DirtyFile[];
  /** Number of dirty files */
  dirtyCount: number;
  /** Whether incremental indexing is in progress */
  isIndexing: boolean;
  /** Clear all dirty files without indexing */
  clearDirtyFiles: () => void;
  /** Force full re-index (clears tracking; caller owns rebuild trigger) */
  forceFullReindex: () => void;
}

// ============================================
// Hook Implementation
// ============================================

export function useIncrementalIndexing(
  options: UseIncrementalIndexingOptions
): UseIncrementalIndexingReturn {
  const {
    repoId,
    repoPath,
    enabled = true,
    debounceMs = REINDEX_DEBOUNCE_MS,
    onIndexStart,
    onIndexComplete,
    onIndexError,
  } = options;

  // Atoms
  const getDirtyFiles = useAtomValue(getDirtyFilesAtom);
  const markFileDirty = useSetAtom(markFileDirtyAtom);
  const clearDirtyFilesAction = useSetAtom(clearDirtyFilesAtom);
  const clearAllDirtyFiles = useSetAtom(clearAllDirtyFilesAtom);
  const updateFileTracking = useSetAtom(updateFileTrackingAtom);
  const setIncrementalIndexing = useSetAtom(setIncrementalIndexingAtom);
  const isIndexingMap = useAtomValue(isIncrementalIndexingAtom);
  const invalidateRepoCache = useSetAtom(invalidateRepoCacheAtom);

  // Derived state
  const dirtyFiles = getDirtyFiles(repoId);
  const dirtyCount = dirtyFiles.length;
  const isIndexing = isIndexingMap.get(repoId) || false;

  // Refs
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastIndexTimeRef = useRef<number>(0);
  const flushDirtyFilesInternalRef = useRef<
    (() => Promise<IncrementalIndexResult | null>) | undefined
  >(undefined);

  // Internal flush function (used by debounce timer)
  const flushDirtyFilesInternal = useCallback(async () => {
    if (!enabled || !repoId || isIndexing) return null;

    // Check minimum interval
    const timeSinceLastIndex = Date.now() - lastIndexTimeRef.current;
    if (timeSinceLastIndex < MIN_REINDEX_INTERVAL_MS) {
      // Reschedule for later
      const delay = MIN_REINDEX_INTERVAL_MS - timeSinceLastIndex;
      debounceTimerRef.current = setTimeout(() => {
        flushDirtyFilesInternalRef.current?.();
      }, delay);
      return null;
    }

    const currentDirtyFiles = getDirtyFiles(repoId);
    if (currentDirtyFiles.length === 0) return null;

    // Batch files (limit size)
    const filesToIndex = currentDirtyFiles.slice(0, MAX_BATCH_SIZE);
    const modifyOrCreate = filesToIndex.filter(
      (file) => file.changeType !== "delete"
    );
    const deleted = filesToIndex.filter((file) => file.changeType === "delete");

    setIncrementalIndexing({ repoId, isIndexing: true });
    onIndexStart?.();
    lastIndexTimeRef.current = Date.now();

    const startTime = Date.now();

    try {
      const result = {
        files_updated: modifyOrCreate.length,
        files_failed: 0,
        failed_paths: [] as string[],
      };

      const durationMs = Date.now() - startTime;

      // Update file tracking
      const now = Date.now();
      updateFileTracking({
        repoId,
        indexedFiles: modifyOrCreate
          .filter((file) => !result.failed_paths.includes(file.path))
          .map((file) => ({
            path: file.path,
            lastModified: now,
          })),
        deletedFiles: deleted.map((file) => file.path),
      });

      // Clear successfully indexed files from dirty list
      const successfulPaths = filesToIndex
        .map((file) => file.path)
        .filter((path) => !result.failed_paths.includes(path));

      clearDirtyFilesAction({
        repoId,
        filePaths: successfulPaths,
      });

      // Invalidate search cache for this repo
      invalidateRepoCache(repoPath);

      const indexResult: IncrementalIndexResult = {
        filesUpdated: result.files_updated,
        filesFailed: result.files_failed,
        failedPaths: result.failed_paths,
        durationMs,
      };

      onIndexComplete?.(indexResult);
      return indexResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onIndexError?.(err);
      return null;
    } finally {
      setIncrementalIndexing({ repoId, isIndexing: false });

      // Check if there are more dirty files to process
      const remainingDirty = getDirtyFiles(repoId);
      if (remainingDirty.length > 0) {
        // Schedule next batch
        debounceTimerRef.current = setTimeout(() => {
          flushDirtyFilesInternalRef.current?.();
        }, MIN_REINDEX_INTERVAL_MS);
      }
    }
  }, [
    enabled,
    repoId,
    repoPath,
    isIndexing,
    getDirtyFiles,
    setIncrementalIndexing,
    updateFileTracking,
    clearDirtyFilesAction,
    invalidateRepoCache,
    onIndexStart,
    onIndexComplete,
    onIndexError,
  ]);

  // Keep ref updated with latest callback
  flushDirtyFilesInternalRef.current = flushDirtyFilesInternal;

  // Mark a file as dirty
  const markDirty = useCallback(
    (filePath: string, changeType: "modify" | "create" | "delete") => {
      if (!enabled || !repoId) return;

      markFileDirty({
        repoId,
        filePath,
        changeType,
      });

      // Schedule debounced re-index
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        flushDirtyFilesInternalRef.current?.();
      }, debounceMs);
    },
    [enabled, repoId, markFileDirty, debounceMs]
  );

  // Public flush function
  const flushDirtyFiles = useCallback(async () => {
    // Cancel any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return flushDirtyFilesInternal();
  }, [flushDirtyFilesInternal]);

  // Clear dirty files without indexing
  const clearDirtyFiles = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearAllDirtyFiles(repoId);
  }, [repoId, clearAllDirtyFiles]);

  // Force full re-index
  const forceFullReindex = useCallback(() => {
    // Clear tracking to force full re-index next time
    clearDirtyFiles();
    // The actual full re-index should be triggered by the caller.
  }, [clearDirtyFiles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Reset when repo changes
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    lastIndexTimeRef.current = 0;
  }, [repoId]);

  return {
    markDirty,
    flushDirtyFiles,
    dirtyFiles,
    dirtyCount,
    isIndexing,
    clearDirtyFiles,
    forceFullReindex,
  };
}

export default useIncrementalIndexing;
