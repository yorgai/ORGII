/**
 * useRecentFiles Hook
 *
 * Description: Manages a list of recently viewed files in the simulator
 *
 * Features:
 * - Tracks last N files (default 5) per category (edit/read)
 * - Prevents duplicates
 * - Most recent file first
 * - Current file always in leftmost position
 * - Provides methods to add files and select active file
 */
import { useCallback, useState } from "react";

import { getAppSubtool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

// ============================================
// Helper Functions
// ============================================

/**
 * Determine file category based on event type.
 * Uses Rust registry (getAppSubtool) as single source of truth.
 */
export function getFileCategoryFromEventType(eventType: string): FileCategory {
  const subtool = getAppSubtool(eventType);

  if (subtool === "file_write") {
    return "edit";
  }
  if (subtool === "file_read") {
    return "read";
  }

  // Default to edit for unknown types
  return "edit";
}

// Hook configuration options
export interface UseRecentFilesOptions {
  /** Maximum number of recent files to track */
  maxFiles?: number;
}

// File category types
export type FileCategory = "edit" | "read";

// File info structure
export interface RecentFile {
  /** File path */
  path: string;
  /** Display name (filename only) */
  name: string;
  /** Event ID that created/modified this file */
  eventId: string;
  /** Event type (create_file, file_diff, etc.) */
  eventType: string;
  /** File category (edit or read) */
  category: FileCategory;
  /** File content (for rendering without switching events) */
  oldContent?: string;
  /** New content (for diffs) */
  newContent?: string;
  /** Event creation timestamp (for timeline filtering) */
  createdTime: number;
}

// Hook return value type
export interface UseRecentFilesReturn {
  /** List of recent files (most recent first) */
  recentFiles: RecentFile[];
  /** Currently active file path */
  activeFile: string | null;
  /** Add a file to recent files list */
  addRecentFile: (file: RecentFile) => void;
  /** Set the active file */
  setActiveFile: (path: string | null) => void;
  /** Clear all recent files */
  clearRecentFiles: () => void;
  /** Get file by path */
  getFileByPath: (path: string) => RecentFile | undefined;
  /** Get files by category (edit or read), filtered by timeline, with current file first */
  getFilesByCategory: (
    category: FileCategory,
    currentFile?: RecentFile,
    maxTimestamp?: number
  ) => RecentFile[];
}

// Default configuration
const DEFAULT_OPTIONS: UseRecentFilesOptions = {
  maxFiles: 5,
};

/**
 * Hook for managing recently viewed files in simulator
 */
export function useRecentFiles(
  options: UseRecentFilesOptions = {}
): UseRecentFilesReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // State
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Add a file to recent files list
  const addRecentFile = useCallback(
    (file: RecentFile) => {
      setRecentFiles((prev) => {
        // Check if file already exists
        const existingIndex = prev.findIndex((f) => f.path === file.path);

        if (existingIndex !== -1) {
          // File exists - update it with latest content if timestamp is newer
          const existing = prev[existingIndex];
          if (file.createdTime >= existing.createdTime) {
            // Update with latest content, keep at same position
            const updated = [...prev];
            updated[existingIndex] = file;
            return updated;
          }
          // Older event - don't update
          return prev;
        }

        // New file - add to front
        const updated = [file, ...prev];
        // Limit to max files
        return updated.slice(0, opts.maxFiles);
      });
      // Set as active file
      setActiveFile(file.path);
    },
    [opts.maxFiles]
  );

  // Clear all recent files
  const clearRecentFiles = useCallback(() => {
    setRecentFiles([]);
    setActiveFile(null);
  }, []);

  // Get file by path
  const getFileByPath = useCallback(
    (path: string): RecentFile | undefined => {
      return recentFiles.find((f) => f.path === path);
    },
    [recentFiles]
  );

  // Get files by category, with current file always first, filtered by timeline
  const getFilesByCategory = useCallback(
    (
      category: FileCategory,
      currentFile?: RecentFile,
      maxTimestamp?: number
    ): RecentFile[] => {
      // Filter by category and timeline (only show files up to current event)
      const filtered = recentFiles.filter((f) => {
        if (f.category !== category) return false;
        // If maxTimestamp provided, only include files created before/at current event
        if (maxTimestamp !== undefined && f.createdTime > maxTimestamp)
          return false;
        return true;
      });

      if (!currentFile) {
        return filtered;
      }

      // Find current file in the filtered list
      const currentFileIndex = filtered.findIndex(
        (f) => f.path === currentFile.path
      );

      if (currentFileIndex === -1) {
        // Current file not in list yet - add it at the front
        return [currentFile, ...filtered].slice(0, opts.maxFiles);
      }

      // Move current file to first position
      const fileAtIndex = filtered[currentFileIndex];
      const others = filtered.filter((_, idx) => idx !== currentFileIndex);

      return [fileAtIndex, ...others];
    },
    [recentFiles, opts.maxFiles]
  );

  return {
    recentFiles,
    activeFile,
    addRecentFile,
    setActiveFile,
    clearRecentFiles,
    getFileByPath,
    getFilesByCategory,
  };
}

export default useRecentFiles;
