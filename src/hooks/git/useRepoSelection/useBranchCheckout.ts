/**
 * useBranchCheckout - Handles branch checkout with conflict resolution
 */
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

import { gitApi } from "@src/api/http/git";
import { createLogger } from "@src/hooks/logger";
import {
  REPO_KIND,
  currentBranchAtom,
  currentRepoAtom,
  repoMapAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

import {
  addCheckoutStateListener,
  isCheckingOut,
  notifyCheckoutState,
  setIsCheckingOut,
} from "./singleton";
import type { UseBranchCheckoutReturn } from "./types";

const log = createLogger("useBranchCheckout");

export function useBranchCheckout(): UseBranchCheckoutReturn {
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const [currentBranch, setCurrentBranch] = useAtom(currentBranchAtom);
  const repoMap = useAtomValue(repoMapAtom);
  const currentRepo = useAtomValue(currentRepoAtom);

  const [checkoutLoading, setCheckoutLoading] = useState(isCheckingOut);

  // Subscribe to checkout state changes from any hook instance
  useEffect(() => {
    return addCheckoutStateListener((loading) => setCheckoutLoading(loading));
  }, []);

  const selectBranch = useCallback(
    async (branch: string) => {
      if (!selectedRepoId) {
        log.warn("[useBranchCheckout] Cannot checkout: no repo selected");
        return;
      }

      const repo = repoMap.get(selectedRepoId) || currentRepo;
      const repoPath =
        repo?.path || repo?.fs_uri || currentRepo?.path || currentRepo?.fs_uri;

      if (!repoPath) {
        log.warn("[useBranchCheckout] Cannot checkout: no repo path");
        return;
      }

      // Plain work folders are not git repos — never call the checkout API.
      if (repo?.kind === REPO_KIND.FOLDER) {
        flushSync(() => {
          setCurrentBranch(branch);
        });
        return;
      }

      // Clearing branch state without git (e.g. after selecting a work folder).
      if (branch.trim() === "") {
        flushSync(() => {
          setCurrentBranch(branch);
        });
        return;
      }

      const previousBranch = currentBranch;

      // Mark checkout in progress
      setIsCheckingOut(true);
      notifyCheckoutState(true);

      // Optimistic update
      flushSync(() => {
        setCurrentBranch(branch);
      });
      try {
        const result = await gitApi.gitCheckout({
          repo_id: selectedRepoId,
          repo_path: repoPath,
          ref: branch,
        });

        if (result.success) {
          // Branch checkout successful
        } else {
          // Rollback on failure
          setCurrentBranch(previousBranch);
          log.error(
            `[useBranchCheckout] Failed to checkout branch "${branch}":`,
            result.error,
            `errorType: ${result.errorType}`
          );

          if (result.errorType === "uncommitted_changes") {
            await handleUncommittedChanges(
              branch,
              selectedRepoId,
              repoPath,
              setCurrentBranch
            );
          } else {
            showGitActionDialogSafely(
              result.error || `Failed to checkout branch "${branch}"`,
              "error"
            );
          }
        }
      } catch (error) {
        setCurrentBranch(previousBranch);
        log.error("[useBranchCheckout] Checkout error:", error);
        showGitActionDialogSafely(
          error instanceof Error
            ? error.message
            : `Failed to checkout branch "${branch}"`,
          "error"
        );
      } finally {
        setIsCheckingOut(false);
        notifyCheckoutState(false);
      }
    },
    [selectedRepoId, repoMap, currentRepo, currentBranch, setCurrentBranch]
  );

  return {
    checkoutLoading,
    selectBranch,
  };
}

/**
 * Handle uncommitted changes conflict during checkout
 */
async function handleUncommittedChanges(
  branch: string,
  repoId: string,
  repoPath: string,
  setCurrentBranch: (branch: string) => void
) {
  const { CheckoutConflictDialog } = await import("@src/components/GitDialogs");
  const choice = await CheckoutConflictDialog.open({
    branchName: branch,
  });

  if (choice === "stash") {
    await handleStashAndCheckout(branch, repoId, repoPath, setCurrentBranch);
  } else if (choice === "force") {
    await handleForceCheckout(branch, repoId, repoPath, setCurrentBranch);
  }
  // choice === "cancel" - do nothing
}

async function handleStashAndCheckout(
  branch: string,
  repoId: string,
  repoPath: string,
  setCurrentBranch: (branch: string) => void
) {
  try {
    const stashResult = await gitApi.gitStashPush({
      repo_id: repoId,
      repo_path: repoPath,
      message: `Auto-stash before switching to ${branch}`,
      include_untracked: true,
    });

    if (!stashResult) {
      showGitActionDialogSafely("Failed to stash changes", "error");
      return;
    }

    const checkoutResult = await gitApi.gitCheckout({
      repo_id: repoId,
      repo_path: repoPath,
      ref: branch,
    });

    if (checkoutResult.success) {
      setCurrentBranch(branch);
      showGitActionDialogSafely(
        `Switched to ${branch}. Changes stashed.`,
        "info"
      );
    } else {
      showGitActionDialogSafely(
        checkoutResult.error || "Failed to checkout after stash",
        "error"
      );
    }
  } catch {
    showGitActionDialogSafely("Failed to stash and checkout", "error");
  }
}

async function handleForceCheckout(
  branch: string,
  repoId: string,
  repoPath: string,
  setCurrentBranch: (branch: string) => void
) {
  try {
    const forceResult = await gitApi.gitCheckout({
      repo_id: repoId,
      repo_path: repoPath,
      ref: branch,
      force: true,
    });

    if (forceResult.success) {
      setCurrentBranch(branch);
      showGitActionDialogSafely(`Switched to ${branch}`, "info");
    } else {
      showGitActionDialogSafely(
        forceResult.error || "Failed to force checkout",
        "error"
      );
    }
  } catch {
    showGitActionDialogSafely("Failed to force checkout", "error");
  }
}
