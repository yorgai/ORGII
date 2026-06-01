/**
 * useFileMode Hook
 *
 * File search mode for EditorPalette - integrates with native file search
 */
import { createElement, useEffect, useRef, useState } from "react";

import FileTypeIcon, {
  getFileTypeFromName,
} from "@src/components/FileTypeIcon";
import {
  prewarmFileIndex,
  searchFilesNative,
} from "@src/util/platform/tauri/fileSearch";

import type { SpotlightItem } from "../../../shared";
import type { FileSearchResult } from "../types";

export interface UseFileModeOptions {
  repoPath: string;
  searchTerm: string;
  enabled: boolean;
  onFileOpen?: (path: string) => void;
}

export interface UseFileModeReturn {
  items: SpotlightItem[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to generate file search items
 */
export function useFileMode({
  repoPath,
  searchTerm,
  enabled,
  onFileOpen,
}: UseFileModeOptions): UseFileModeReturn {
  const [files, setFiles] = useState<FileSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether the first search has fired so we can skip debounce for it
  const hasFiredFirstSearch = useRef(false);

  // Reset first-search flag when spotlight is disabled (closed)
  useEffect(() => {
    if (!enabled) {
      hasFiredFirstSearch.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !repoPath) return;

    prewarmFileIndex(repoPath).catch(() => {
      // Non-fatal — search will still work if prewarm fails.
    });
  }, [enabled, repoPath]);

  // Search files
  useEffect(() => {
    if (!enabled || !repoPath) {
      setFiles([]);
      return;
    }

    // If empty query, don't search yet (could show recent files later)
    if (!searchTerm) {
      setFiles([]);
      setIsLoading(false);
      return;
    }

    const searchFiles = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const startedAt = performance.now();
        const results = await searchFilesNative({
          root_path: repoPath,
          query: searchTerm,
          // Use default (500) - comprehensive search like VS Code
          // For Spotlight UI, we may show fewer but search is complete
          exclude_dirs: [
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
          ],
        });
        const elapsedMs = Math.round(performance.now() - startedAt);
        if (elapsedMs > 500) {
          console.warn("[EditorPalette] Slow file search", {
            elapsedMs,
            nativeSearchTimeMs: results.search_time_ms,
            totalIndexed: results.total_indexed,
            queryLength: searchTerm.length,
          });
        }

        const fileResults: FileSearchResult[] = results.files.map((f) => {
          // Extract relative path and directory
          const relativePath = f.path.replace(repoPath, "").replace(/^\//, "");
          const parts = relativePath.split("/");
          const name = parts[parts.length - 1];
          const directory = parts.slice(0, -1).join("/") || "/";

          return {
            path: f.path,
            name,
            directory,
            score: f.score,
          };
        });

        setFiles(fileResults);
      } catch (err) {
        console.error("[useFileMode] Search failed:", err);
        setError(err instanceof Error ? err.message : "Search failed");
        setFiles([]);
      } finally {
        setIsLoading(false);
      }
    };

    // Fire first search immediately (no debounce), debounce subsequent ones
    if (!hasFiredFirstSearch.current) {
      hasFiredFirstSearch.current = true;
      searchFiles();
      return;
    }

    // Debounce subsequent searches (150ms)
    const timer = setTimeout(searchFiles, 150);
    return () => clearTimeout(timer);
  }, [repoPath, searchTerm, enabled]);

  // Convert files to spotlight items
  const items: SpotlightItem[] = files.map((file) => {
    const fileType = getFileTypeFromName(file.name);

    // Create icon component for this file
    const FileIcon = () => {
      return createElement(FileTypeIcon, {
        fileName: file.name,
        type: fileType,
        size: "spotlight",
      });
    };

    return {
      id: file.path,
      label: file.name,
      // Don't show description - single line only
      icon: FileIcon,
      type: "file",
      data: {
        rightLabel: file.directory,
      },
      action: () => {
        onFileOpen?.(file.path);
      },
    };
  });

  return {
    items,
    isLoading,
    error,
  };
}

export default useFileMode;
