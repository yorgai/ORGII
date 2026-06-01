/**
 * Global Flow Tracker Hook - automatically tracks common user activities.
 *
 * Mount this hook at the app root to enable automatic tracking of:
 * - File changes (via Tauri file watcher events)
 * - Git operations (via repo events from git watch)
 * - Lint diagnostics (via lint scan events)
 *
 * Note: Terminal commands and searches are tracked by the agent system,
 * not via events. The Rust backend directly records them.
 *
 * @example
 * ```tsx
 * // In App.tsx or a top-level component
 * function App() {
 *   useGlobalFlowTracker();
 *   return <Router>...</Router>;
 * }
 * ```
 */
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useFlowAwareness } from "./useFlowAwareness";

// ============================================
// Event Types (matching Rust emit payloads)
// ============================================

/** File change event from git watch (file:changed) */
interface FileChangedEvent {
  repo_id: string;
  path: string;
  kind: string; // "modified", "created", "deleted", "renamed"
}

/** Lint tool completed event (lint:tool_completed) */
interface LintToolCompletedEvent {
  tool: string;
  diagnostics: Array<{
    file: string;
    line: number;
    column: number;
    message: string;
    severity: "error" | "warning" | "info" | "hint";
    rule?: string;
    source?: string;
  }>;
  files_scanned: number;
  error?: string;
}

/** Repo changed event (repo:changed) */
interface RepoChangedEvent {
  repo_id: string;
  change_type: "files" | "git_meta" | "branch" | "remote";
  affected_count: number;
}

export function useGlobalFlowTracker(): void {
  const { recordFileEdit, recordGitOperation, recordError } = useFlowAwareness({
    enabled: true,
  });

  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];

    // ========================================
    // File Changes (file:changed)
    // ========================================
    listen<FileChangedEvent>("file:changed", (event) => {
      const { path, kind } = event.payload;
      const editType =
        kind === "created"
          ? "create"
          : kind === "deleted"
            ? "delete"
            : kind === "renamed"
              ? "rename"
              : "modify";
      recordFileEdit(path, editType);
    }).then((unlisten) => unlistenFns.push(unlisten));

    // ========================================
    // Git Operations (repo:changed with git_meta/branch)
    // ========================================
    listen<RepoChangedEvent>("repo:changed", (event) => {
      const { change_type } = event.payload;
      // Track branch changes as git operations
      if (change_type === "branch") {
        recordGitOperation("branch_switch");
      }
    }).then((unlisten) => unlistenFns.push(unlisten));

    // ========================================
    // Lint Diagnostics (lint:tool_completed)
    // ========================================
    listen<LintToolCompletedEvent>("lint:tool_completed", (event) => {
      const { diagnostics, error } = event.payload;

      // Record tool-level errors
      if (error) {
        recordError("lint", error);
      }

      // Record individual lint errors (not warnings)
      for (const diag of diagnostics) {
        if (diag.severity === "error") {
          recordError("lint", diag.message, diag.file, diag.line);
        }
      }
    }).then((unlisten) => unlistenFns.push(unlisten));

    return () => {
      unlistenFns.forEach((unlisten) => unlisten());
    };
  }, [recordFileEdit, recordGitOperation, recordError]);
}
