/**
 * useFileReveal Hook
 *
 * Manages auto-reveal logic for files in the explorer.
 * Triggers reveal when:
 * 1. activeFilePath changes while on files tab
 * 2. User switches TO files tab when there's an active file (e.g., from Source Control)
 *
 * PERFORMANCE (Jan 2026):
 * - Skips reveal when selection originates from explorer click (file already visible)
 * - Uses explorerClickPathRef to track clicks from explorer
 */
import { type MutableRefObject, useEffect, useRef, useState } from "react";

import type { EditorPrimarySidebarViewMode, RevealRequest } from "../types";

export interface UseFileRevealOptions {
  activeFilePath?: string | null;
  viewMode: EditorPrimarySidebarViewMode;
  onRevealFile?: (filePath: string) => Promise<void>;
  /** Ref to track if selection came from explorer click (skip reveal if so) */
  explorerClickPathRef?: MutableRefObject<string | null>;
}

export interface UseFileRevealResult {
  revealRequest: RevealRequest | null;
}

export function useFileReveal({
  activeFilePath,
  viewMode,
  onRevealFile,
  explorerClickPathRef,
}: UseFileRevealOptions): UseFileRevealResult {
  // Track previous values to detect changes
  const prevActiveFilePathRef = useRef<string | null>(null);
  const prevViewModeRef = useRef<EditorPrimarySidebarViewMode>(viewMode);
  // Use a counter instead of timestamp to avoid impure Date.now() calls
  const [revealCounter, setRevealCounter] = useState(0);
  // Track the path that triggered the reveal
  const [revealPath, setRevealPath] = useState<string | null>(null);

  // Auto-reveal when:
  // 1. activeFilePath changes while on files tab
  // 2. viewMode changes TO "files" when there's an active file
  useEffect(() => {
    const filePathChanged =
      activeFilePath && activeFilePath !== prevActiveFilePathRef.current;
    const switchedToFilesTab =
      viewMode === "files" && prevViewModeRef.current !== "files";

    // Update refs
    prevActiveFilePathRef.current = activeFilePath ?? null;
    prevViewModeRef.current = viewMode;

    // Skip if no active file
    if (!activeFilePath) {
      return;
    }

    // PERFORMANCE: Skip reveal entirely if selection came from explorer click
    // The file is already visible in the tree (user just clicked on it),
    // no need to reveal or scroll - preserve current scroll position
    if (explorerClickPathRef?.current === activeFilePath) {
      // Clear the ref and skip reveal entirely
      explorerClickPathRef.current = null;
      return;
    }

    // Reveal if: on files tab AND (file changed OR just switched to files tab)
    if (viewMode === "files" && (filePathChanged || switchedToFilesTab)) {
      // Call reveal function to expand parent directories
      if (onRevealFile) {
        onRevealFile(activeFilePath);
      }
      // Use queueMicrotask to avoid synchronous setState in effect body
      queueMicrotask(() => {
        setRevealPath(activeFilePath);
        setRevealCounter((prev) => prev + 1);
      });
    }
  }, [activeFilePath, viewMode, onRevealFile, explorerClickPathRef]);

  // Compute reveal request
  const revealRequest: RevealRequest | null =
    revealPath && viewMode === "files"
      ? { path: revealPath, timestamp: revealCounter }
      : null;

  return {
    revealRequest,
  };
}
