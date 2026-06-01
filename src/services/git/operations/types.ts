/**
 * Shared types and helpers for Git operations modules.
 */
import type { GitErrorType } from "@src/api/http/git/streaming";
import { gitOutputIntegrationAtom } from "@src/store/workstation/codeEditor/outputIntegration";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

// ============================================
// Types
// ============================================

export interface GitOperationResult {
  success: boolean;
  errorType: GitErrorType;
  message?: string;
}

export interface RepoContext {
  repoId: string;
  repoPath: string;
}

// ============================================
// Repo Context (module-level singleton)
// ============================================

let repoContext: RepoContext | null = null;

export function setRepoContext(repoId: string, repoPath: string): void {
  repoContext = { repoId, repoPath };
}

export function getRepoContext(): RepoContext | null {
  return repoContext;
}

// ============================================
// Helper Functions
// ============================================

export function getStore() {
  return getInstrumentedStore();
}

export function getOutputIntegration() {
  return getStore().get(gitOutputIntegrationAtom);
}

export function parseGitError(error: unknown): {
  type: GitErrorType;
  message: string;
} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (
      message.includes("authentication") ||
      message.includes("auth") ||
      message.includes("permission denied")
    ) {
      return { type: "authentication_failed", message: error.message };
    }

    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("timeout")
    ) {
      return { type: "network_error", message: error.message };
    }

    if (message.includes("conflict") || message.includes("merge")) {
      return { type: "merge_conflicts", message: error.message };
    }

    return { type: "unknown", message: error.message };
  }

  return { type: "unknown", message: String(error) };
}
