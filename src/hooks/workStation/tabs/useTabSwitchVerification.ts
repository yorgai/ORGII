/**
 * useTabSwitchVerification Hook
 *
 * VSCode-style on-tab-switch verification using `git ls-files --stage`.
 * Checks file staleness and git status when a tab becomes active.
 *
 * Benefits:
 * - Lightweight: Only checks on tab switch, not continuous watching
 * - Catches external changes: Git operations, other editors, build tools
 * - No backend file watcher needed: Uses existing git infrastructure
 * - VSCode-proven: Same approach used by VSCode
 *
 * Uses IDE Server HTTP endpoints on port 13847 (not Tauri invoke).
 */
import { useCallback, useEffect, useState } from "react";

import { createLogger } from "@src/hooks/logger";

import { FILE_API_BASE_URL } from "../fileContent/constants";

const log = createLogger("TabSwitchVerification");

// ============================================
// Types
// ============================================

export interface GitFileStatus {
  /** Whether the file is tracked in git */
  isTracked: boolean;
  /** Whether the file is staged */
  isStaged: boolean;
  /** Git blob hash (if tracked) */
  blobHash: string | null;
  /** File modification time (milliseconds since UNIX epoch) */
  mtime: number;
  /** Git conflict stage (0=normal, 1=base, 2=ours, 3=theirs) */
  conflictStage: number;
}

export interface UseTabSwitchVerificationOptions {
  /** File path to verify */
  filePath: string | null;
  /** Repository path */
  repoPath: string;
  /** Last known modification time */
  lastKnownMtime: number | null;
  /** Callback when stale file is detected */
  onStaleDetected: () => void;
  /** Callback when git status changes */
  onGitStatusChanged: (status: GitFileStatus) => void;
}

export interface UseTabSwitchVerificationReturn {
  /** Set whether this tab is active */
  setTabActive: (active: boolean) => void;
  /** Manually trigger verification now */
  verifyNow: () => Promise<void>;
}

// ============================================
// Main Hook
// ============================================

export function useTabSwitchVerification(
  options: UseTabSwitchVerificationOptions
): UseTabSwitchVerificationReturn {
  const {
    filePath,
    repoPath,
    lastKnownMtime,
    onStaleDetected,
    onGitStatusChanged,
  } = options;

  // Track if this tab is active
  const [isActive, setIsActive] = useState(false);

  // Verify file status on tab activation
  const verifyFile = useCallback(async () => {
    if (!filePath || !repoPath) return;

    try {
      // Call IDE Server HTTP endpoint
      const params = new URLSearchParams({
        repo_path: repoPath,
        file_path: filePath,
      });

      const response = await fetch(
        `${FILE_API_BASE_URL}/git-status?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const status: GitFileStatus = result.data;

      // Check staleness (file modified on disk since we loaded it)
      if (lastKnownMtime && status.mtime > lastKnownMtime) {
        onStaleDetected();
      }

      // Update git status (for decorations, merge conflict detection, etc.)
      onGitStatusChanged(status);
    } catch (error) {
      throw new Error(
        `[TabSwitchVerification] Failed to verify ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [filePath, repoPath, lastKnownMtime, onStaleDetected, onGitStatusChanged]);

  // Call verify when tab becomes active
  useEffect(() => {
    if (isActive && filePath) {
      verifyFile().catch((error) => {
        log.warn("[TabSwitchVerification]", error);
      });
    }
  }, [isActive, filePath, verifyFile]);

  return {
    setTabActive: setIsActive,
    verifyNow: verifyFile,
  };
}
