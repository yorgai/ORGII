/**
 * useFileWatchIndexing Hook
 *
 * Integrates file watching events with incremental indexing.
 * Listens for file changes and triggers re-indexing of modified files.
 */
import { useCallback, useEffect, useRef } from "react";

import { getCodeEditorWebSocket } from "@src/api/realtime/codeEditorWebSocket";

import { useIncrementalIndexing } from "./useIncrementalIndexing";

// ============================================
// Types
// ============================================

export interface UseFileWatchIndexingOptions {
  /** Repository ID */
  repoId: string;
  /** Repository path */
  repoPath: string;
  /** Whether file watch indexing is enabled (default: true) */
  enabled?: boolean;
  /** File extensions to index (default: common code files) */
  indexExtensions?: string[];
  /** Directories to exclude from indexing */
  excludeDirs?: string[];
  /** Callback when a file is marked dirty */
  onFileDirty?: (
    filePath: string,
    changeType: "modify" | "create" | "delete"
  ) => void;
  /** Callback when incremental indexing completes */
  onIndexComplete?: (filesUpdated: number) => void;
}

export interface UseFileWatchIndexingReturn {
  /** Number of files pending re-indexing */
  pendingCount: number;
  /** Whether incremental indexing is in progress */
  isIndexing: boolean;
  /** Manually trigger re-indexing of pending files */
  flushPendingFiles: () => Promise<void>;
  /** Clear pending files without indexing */
  clearPendingFiles: () => void;
}

// ============================================
// Constants
// ============================================

const DEFAULT_INDEX_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".scala",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
];

const DEFAULT_EXCLUDE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "target",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
];

// ============================================
// Hook Implementation
// ============================================

export function useFileWatchIndexing(
  options: UseFileWatchIndexingOptions
): UseFileWatchIndexingReturn {
  const {
    repoId,
    repoPath,
    enabled = true,
    indexExtensions = DEFAULT_INDEX_EXTENSIONS,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    onFileDirty,
    onIndexComplete,
  } = options;

  // Use incremental indexing hook
  const {
    markDirty,
    flushDirtyFiles,
    dirtyCount,
    isIndexing,
    clearDirtyFiles,
  } = useIncrementalIndexing({
    repoId,
    repoPath,
    enabled,
    onIndexComplete: (result) => {
      onIndexComplete?.(result.filesUpdated);
    },
  });

  // Track previous files for change detection
  const previousFilesRef = useRef<
    Map<string, { status: string; staged: boolean }>
  >(new Map());

  // Check if a file should be indexed based on extension and path
  const shouldIndexFile = useCallback(
    (filePath: string): boolean => {
      // Check exclusions
      for (const excludeDir of excludeDirs) {
        if (
          filePath.includes(`/${excludeDir}/`) ||
          filePath.startsWith(`${excludeDir}/`)
        ) {
          return false;
        }
      }

      // Check extension
      const extension = filePath.substring(filePath.lastIndexOf("."));
      return indexExtensions.includes(extension.toLowerCase());
    },
    [indexExtensions, excludeDirs]
  );

  // Main effect: Set up WebSocket event listeners for file changes
  useEffect(() => {
    if (!enabled || !repoId) return;

    const ws = getCodeEditorWebSocket();
    if (!ws) return;

    let mounted = true;
    const unsubscribeFns: Array<() => void> = [];

    // Reset previous files when repo changes
    previousFilesRef.current.clear();

    // Listen to repo:status_updated events for file changes
    const unsubscribe1 = ws.on("repo:status_updated", (data) => {
      if (!mounted) return;

      const payload = data as {
        type: string;
        repo_id: string;
        status: {
          files?: Array<{
            path: string;
            status: string;
            staged: boolean;
          }>;
        };
      };

      if (payload.repo_id !== repoId) return;

      const files = payload.status?.files || [];
      const currentFiles = new Map<
        string,
        { status: string; staged: boolean }
      >();

      // Build current state
      for (const file of files) {
        currentFiles.set(file.path, {
          status: file.status,
          staged: file.staged,
        });
      }

      // Compare with previous state to detect changes
      const previousFiles = previousFilesRef.current;

      // Find new or modified files
      for (const [path, file] of currentFiles) {
        const prev = previousFiles.get(path);
        // Remove leading slash if present
        const relativePath = path.replace(/^\//, "");

        if (!shouldIndexFile(relativePath)) continue;

        if (!prev) {
          // New file in git status
          const changeType = file.status === "?" ? "create" : "modify";
          markDirty(relativePath, changeType);
          onFileDirty?.(relativePath, changeType);
        } else if (prev.status !== file.status) {
          // Status changed - file was modified
          markDirty(relativePath, "modify");
          onFileDirty?.(relativePath, "modify");
        }
      }

      // Find removed files (were in git status, now clean or deleted)
      for (const [path] of previousFiles) {
        if (!currentFiles.has(path)) {
          const relativePath = path.replace(/^\//, "");
          if (shouldIndexFile(relativePath)) {
            // File is now clean or was deleted
            // We can't easily distinguish, so treat as modify
            // (if deleted, the index update will handle it)
            markDirty(relativePath, "modify");
            onFileDirty?.(relativePath, "modify");
          }
        }
      }

      // Update previous state
      previousFilesRef.current = currentFiles;
    });
    unsubscribeFns.push(unsubscribe1);

    return () => {
      mounted = false;
      for (const fn of unsubscribeFns) {
        try {
          fn();
        } catch (_e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [enabled, repoId, markDirty, shouldIndexFile, onFileDirty]);

  // Listen for manual file save events (editor internal saves)
  useEffect(() => {
    if (!enabled) return;

    const handleFileSaved = (event: Event) => {
      const customEvent = event as CustomEvent<{ path: string }>;
      const filePath = customEvent.detail.path;
      const relativePath = filePath.replace(repoPath, "").replace(/^[/\\]/, "");

      if (shouldIndexFile(relativePath)) {
        markDirty(relativePath, "modify");
        onFileDirty?.(relativePath, "modify");
      }
    };

    window.addEventListener("filesync:file-saved", handleFileSaved);

    return () => {
      window.removeEventListener("filesync:file-saved", handleFileSaved);
    };
  }, [enabled, repoPath, markDirty, shouldIndexFile, onFileDirty]);

  // Public methods
  const flushPendingFiles = useCallback(async () => {
    await flushDirtyFiles();
  }, [flushDirtyFiles]);

  const clearPendingFiles = useCallback(() => {
    clearDirtyFiles();
  }, [clearDirtyFiles]);

  return {
    pendingCount: dirtyCount,
    isIndexing,
    flushPendingFiles,
    clearPendingFiles,
  };
}

export default useFileWatchIndexing;
