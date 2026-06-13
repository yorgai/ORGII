/**
 * useGitBlame Hook
 *
 * Fetches git blame data for a file and provides it as a ref
 * for the CodeMirror gitBlame extension to read synchronously.
 *
 * - Fetches on file open (filePath change)
 * - Re-fetches on save (saveCounter change)
 * - Returns a ref to avoid React re-renders on cursor movement
 * - Gracefully returns empty map for untracked/new files
 * - Skips fetch for files > MAX_BLAME_LINES
 */
import { useAtomValue } from "jotai";
import { type RefObject, useEffect, useRef } from "react";

import { getGitBlame } from "@src/api/http/git/blame";
import type { BlameLineData } from "@src/features/CodeMirror/config/gitBlame";
import { createLogger } from "@src/hooks/logger";
import { selectedRepoIdAtom } from "@src/store/repo";

const log = createLogger("useGitBlame");

// ============================================
// Configuration
// ============================================

/** Skip blame for files exceeding this line count */
const MAX_BLAME_LINES = 10_000;

// ============================================
// Hook
// ============================================

export interface UseGitBlameOptions {
  /** Absolute file path */
  filePath?: string;
  /** Repo root path, used to compute relative path */
  repoPath?: string;
  /** Increment to trigger re-fetch (e.g. on file save) */
  saveCounter?: number;
  /** Whether blame is enabled (from settings toggle) */
  enabled?: boolean;
}

export interface UseGitBlameReturn {
  /** Ref to blame data map (line number -> BlameLineData). Read by CodeMirror extension. */
  blameDataRef: RefObject<Map<number, BlameLineData>>;
}

export function useGitBlame(
  options: UseGitBlameOptions = {}
): UseGitBlameReturn {
  const { filePath, repoPath, saveCounter = 0, enabled = false } = options;
  const repoId = useAtomValue(selectedRepoIdAtom);
  const blameDataRef = useRef<Map<number, BlameLineData>>(new Map());

  useEffect(() => {
    if (!enabled || !filePath || !repoId) {
      blameDataRef.current = new Map();
      return;
    }

    // Compute relative path from repo root
    let relativePath = filePath;
    if (repoPath && filePath.startsWith(repoPath)) {
      relativePath = filePath.slice(repoPath.length);
      // Remove leading slash
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }
    }

    let cancelled = false;

    const fetchBlame = async () => {
      try {
        const result = await getGitBlame({
          repo_id: repoId,
          file_path: relativePath,
        });

        if (cancelled) return;

        if (!result || !result.lines) {
          blameDataRef.current = new Map();
          return;
        }

        // Skip if too many lines
        if (result.total_lines > MAX_BLAME_LINES) {
          blameDataRef.current = new Map();
          return;
        }

        // Build line number -> blame data map
        const blameMap = new Map<number, BlameLineData>();
        for (const line of result.lines) {
          blameMap.set(line.line_number, {
            line_number: line.line_number,
            commit_sha: line.commit_sha,
            short_sha: line.short_sha,
            author: line.author,
            author_email: line.author_email,
            author_time: line.author_time,
            summary: line.summary,
          });
        }

        if (!cancelled) {
          blameDataRef.current = blameMap;
        }
      } catch (error) {
        // Silently handle errors (file might be untracked, repo not initialized, etc.)
        if (!cancelled) {
          blameDataRef.current = new Map();
        }
        log.debug("[useGitBlame] Blame fetch failed:", error);
      }
    };

    fetchBlame();

    return () => {
      cancelled = true;
    };
  }, [filePath, repoId, repoPath, saveCounter, enabled]);

  return { blameDataRef };
}
