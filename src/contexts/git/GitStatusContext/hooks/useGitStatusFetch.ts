/**
 * useGitStatusFetch - Core git status fetching logic
 *
 * Handles:
 * - Fetching git status from API
 * - Computing suggested action locally
 * - Managing loading/error states
 * - Race condition prevention via abort controllers
 * - Concurrency control with priority-based execution
 */
import { type MutableRefObject, useCallback, useRef } from "react";

// NOTE: activeGitOperations was previously a module-level counter, which
// caused it to be shared across all GitStatusProvider instances (main window,
// Wingman bar, etc.).  It is now a per-hook ref so each provider instance
// manages its own concurrency budget independently.

import { gitApi } from "@src/api/http/git";
import type {
  GitRepositoryStatus,
  GitSuggestedAction,
} from "@src/types/session/steps";
import { decodeOctalPath } from "@src/util/file/pathUtils";
import { computeSuggestedAction } from "@src/util/git/computeSuggestedAction";

import { MAX_CONCURRENT_GIT_OPERATIONS } from "../constants";
import type { GitStatusRefs, StartupState } from "../types";

export function shouldStartGitStatusFetch({
  fetchInProgress,
  activeFetchRepoId,
  selectedRepoId,
}: {
  fetchInProgress: boolean;
  activeFetchRepoId: string | null;
  selectedRepoId: string;
}): boolean {
  return !fetchInProgress || activeFetchRepoId !== selectedRepoId;
}

interface UseGitStatusFetchOptions {
  selectedRepoId: string | null;
  getRepoPath: () => string | undefined;
  repoName?: string;
  refs: Pick<
    GitStatusRefs,
    | "abortControllerRef"
    | "intendedRepoIdRef"
    | "fetchInProgressRef"
    | "startupStateRef"
  >;
  scheduleWatcherRegistration: (
    repoId: string,
    repoPath: string,
    repoName?: string
  ) => void;
  setGitStatus: (status: GitRepositoryStatus | null) => void;
  setGitSuggestedAction: (action: GitSuggestedAction | null) => void;
  setStatusRepoId: (repoId: string | null) => void;
  setStatusRepoPath: (repoPath: string | null) => void;
  setGitStatusAtom: (status: GitRepositoryStatus | null) => void;
  setGitSuggestedActionAtom: (action: GitSuggestedAction | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

interface UseGitStatusFetchReturn {
  fetchStatus: (options?: { silent?: boolean }) => Promise<void>;
  executeGitOperation: (
    operation: () => Promise<void>,
    priority: "critical" | "normal" | "background"
  ) => Promise<void>;
}

export function useGitStatusFetch({
  selectedRepoId,
  getRepoPath,
  repoName,
  refs,
  scheduleWatcherRegistration,
  setGitStatus,
  setGitSuggestedAction,
  setStatusRepoId,
  setStatusRepoPath,
  setGitStatusAtom,
  setGitSuggestedActionAtom,
  setLoading,
  setError,
}: UseGitStatusFetchOptions): UseGitStatusFetchReturn {
  const {
    abortControllerRef,
    intendedRepoIdRef,
    fetchInProgressRef,
    startupStateRef,
  } = refs;

  // Per-instance concurrency counter (replaces the old module-level let).
  const activeGitOperationsRef = useRef(0);
  const activeFetchRepoIdRef = useRef<string | null>(null);

  // Stable ref for executeGitOperation callback
  const startupStateRefStable =
    useRef<MutableRefObject<StartupState>>(startupStateRef);
  startupStateRefStable.current = startupStateRef;

  /**
   * Executes git operations with intelligent concurrency control.
   * Prevents "bad file descriptor" errors by tracking active operations.
   */
  const executeGitOperation = useCallback(
    async (
      operation: () => Promise<void>,
      priority: "critical" | "normal" | "background"
    ) => {
      const thresholds = {
        critical: 999,
        normal: MAX_CONCURRENT_GIT_OPERATIONS,
        background: 0,
      };

      if (activeGitOperationsRef.current >= thresholds[priority]) {
        return;
      }

      activeGitOperationsRef.current++;

      try {
        await operation();

        if (startupStateRefStable.current.current === "loading") {
          startupStateRefStable.current.current = "ready";
        }
      } finally {
        activeGitOperationsRef.current--;
      }
    },
    []
  );

  const fetchStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      const { silent = false } = options || {};

      if (!selectedRepoId) {
        setGitStatus(null);
        setGitSuggestedAction(null);
        setStatusRepoId(null);
        setStatusRepoPath(null);
        setGitStatusAtom(null);
        setGitSuggestedActionAtom(null);
        setLoading(false);
        return;
      }

      const repoPath = getRepoPath();
      if (!repoPath) {
        setGitStatus(null);
        setGitSuggestedAction(null);
        setStatusRepoId(null);
        setStatusRepoPath(null);
        setGitStatusAtom(null);
        setGitSuggestedActionAtom(null);
        return;
      }

      // Prevent duplicate fetches for the same repo, but allow a newer repo
      // selection to supersede an older in-flight request. Rapid repo switching
      // must not leave the final repo unloaded just because the previous
      // request has not settled yet.
      if (
        !shouldStartGitStatusFetch({
          fetchInProgress: fetchInProgressRef.current,
          activeFetchRepoId: activeFetchRepoIdRef.current,
          selectedRepoId,
        })
      ) {
        return;
      }
      fetchInProgressRef.current = true;
      activeFetchRepoIdRef.current = selectedRepoId;

      // RACE CONDITION FIX: Abort any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const fetchRepoId = selectedRepoId;
      intendedRepoIdRef.current = fetchRepoId;

      if (!silent) {
        setLoading(true);
      }
      setError(null);

      try {
        const statusResult = await gitApi.getGitStatus({
          repo_id: fetchRepoId,
          repo_path: repoPath,
          include_untracked: true,
        });

        // STALE RESPONSE CHECK
        if (intendedRepoIdRef.current !== fetchRepoId) {
          return;
        }

        const status: GitRepositoryStatus | null = statusResult
          ? {
              ...statusResult,
              working_directory: {
                ...statusResult.working_directory,
                files: statusResult.working_directory.files.map((file) => ({
                  ...file,
                  path: decodeOctalPath(file.path),
                  original_path: file.original_path
                    ? decodeOctalPath(file.original_path)
                    : null,
                })),
              },
            }
          : null;
        setGitStatus(status);
        setStatusRepoId(fetchRepoId);
        setStatusRepoPath(repoPath);

        const suggestedAction = computeSuggestedAction(status);
        setGitSuggestedAction(suggestedAction);

        setGitStatusAtom(status);
        setGitSuggestedActionAtom(suggestedAction);

        scheduleWatcherRegistration(fetchRepoId, repoPath, repoName);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        if (intendedRepoIdRef.current !== fetchRepoId) {
          return;
        }
        const message =
          err instanceof Error ? err.message : "Failed to fetch status";
        // A folder the user never `git init`'d is not an error condition.
        // The backend now returns a benign `exists: false` (HTTP 200), but
        // guard the error path too so any residual "not a git repository"
        // surface renders a clean "no git" state instead of an error popup.
        const isNotGitRepo = /not a git repository|not_a_git_repo/i.test(
          message
        );
        if (isNotGitRepo) {
          setGitStatus(null);
          setStatusRepoId(fetchRepoId);
          setStatusRepoPath(repoPath);
          setGitSuggestedAction(null);
          setGitStatusAtom(null);
          setGitSuggestedActionAtom(null);
          return;
        }
        setError(message);
      } finally {
        if (intendedRepoIdRef.current === fetchRepoId) {
          setLoading(false);
        }
        if (activeFetchRepoIdRef.current === fetchRepoId) {
          fetchInProgressRef.current = false;
          activeFetchRepoIdRef.current = null;
        }
      }
    },
    [
      selectedRepoId,
      getRepoPath,
      repoName,
      abortControllerRef,
      intendedRepoIdRef,
      fetchInProgressRef,
      scheduleWatcherRegistration,
      setGitStatus,
      setGitSuggestedAction,
      setStatusRepoId,
      setStatusRepoPath,
      setGitStatusAtom,
      setGitSuggestedActionAtom,
      setLoading,
      setError,
    ]
  );

  return { fetchStatus, executeGitOperation };
}
