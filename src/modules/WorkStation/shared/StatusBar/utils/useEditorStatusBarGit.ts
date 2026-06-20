/**
 * useEditorStatusBarGit
 *
 * Encapsulates all git-sync, workspace-label, and sync-in-progress logic
 * for EditorStatusBar, keeping the component file under 600 lines.
 */
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Message from "@src/components/Message";
import { useGitStatus } from "@src/contexts/git";
import { useGitOperations } from "@src/hooks/git/useGitOperations";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useRefreshSpin } from "@src/hooks/ui";
import { workspaceGitStatusMapAtom } from "@src/store/git";
import {
  isMultiRootWorkspaceAtom,
  workspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";
import { workspaceNameAtom } from "@src/store/workspace/derived";

export interface UseEditorStatusBarGitOptions {
  repoName: string | undefined;
  repoPath: string | undefined;
  branchName: string | undefined;
}

export interface UseEditorStatusBarGitReturn {
  workspaceLabel: string | undefined;
  workspaceTooltip: string;
  isMultiRoot: boolean;
  aheadCount: number;
  behindCount: number;
  needsPublish: boolean;
  isSyncBusy: boolean;
  isPublishing: boolean;
  canSyncDisplayedRepo: boolean;
  syncSpinClass: string | undefined;
  handleSyncClick: () => void;
  checkoutLoading: boolean;
}

export function useEditorStatusBarGit({
  repoName,
  repoPath,
  branchName,
}: UseEditorStatusBarGitOptions): UseEditorStatusBarGitReturn {
  const { t } = useTranslation();

  const { scopedGitStatus, loading: statusLoading } = useGitStatus();
  const { selectedRepoId, currentRepo, checkoutLoading } = useRepoSelection({
    autoLoad: false,
  });

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const workspaceGitStatusMap = useAtomValue(workspaceGitStatusMapAtom);
  const workspaceName = useAtomValue(workspaceNameAtom);

  const workspaceLabel = useMemo(() => {
    if (!isMultiRoot) return repoName;
    return workspaceName || `${repoName} Workspace`;
  }, [isMultiRoot, repoName, workspaceName]);

  const workspaceTooltip = useMemo(() => {
    if (!isMultiRoot) return `Repo: ${repoName}`;
    const names = workspaceFolders.map((f) => f.name);
    const label = workspaceName || `${repoName} Workspace`;
    return `${label}\n${workspaceFolders.length} repos: ${names.join(", ")}`;
  }, [isMultiRoot, repoName, workspaceName, workspaceFolders]);

  const selectedRepoPath = currentRepo?.path || currentRepo?.fs_uri;
  const currentGitStatus = useMemo(() => {
    if (!repoPath) return null;
    return (
      workspaceGitStatusMap.get(repoPath) ??
      (scopedGitStatus?.repoPath === repoPath ? scopedGitStatus.status : null)
    );
  }, [repoPath, scopedGitStatus, workspaceGitStatusMap]);
  const operationRepoPath =
    selectedRepoPath === repoPath ? selectedRepoPath : undefined;
  const operationRepoId = operationRepoPath
    ? selectedRepoId || undefined
    : undefined;
  const canSyncDisplayedRepo = !!operationRepoPath;
  const { push, pull, fetch, publish, isLoading } = useGitOperations({
    repoId: operationRepoId,
    repoPath: operationRepoPath,
  });

  const aheadCount = currentGitStatus?.branch_ahead_behind?.ahead ?? 0;
  const behindCount = currentGitStatus?.branch_ahead_behind?.behind ?? 0;
  const needsPublish =
    !currentGitStatus?.current_upstream_branch && currentGitStatus?.exists;

  const handlePublish = useCallback(async () => {
    if (!canSyncDisplayedRepo) return;

    const result = await publish();
    if (result.success) {
      Message.success(
        t("workstation.publishBranchToOrigin", { branch: branchName })
      );
    } else {
      Message.error(
        t("git.messages.publishFailed", { error: result.errorType })
      );
    }
  }, [publish, branchName, canSyncDisplayedRepo, t]);

  const [syncInProgress, setSyncInProgress] = useState(false);

  const handleSync = useCallback(async () => {
    if (!canSyncDisplayedRepo) return;

    if (needsPublish) {
      await handlePublish();
      return;
    }

    setSyncInProgress(true);
    try {
      if (behindCount === 0) {
        const fetchResult = await fetch();
        if (!fetchResult.success) {
          Message.error(
            t("git.messages.fetchFailed", { error: fetchResult.errorType })
          );
          return;
        }
      } else {
        const pullResult = await pull();
        if (!pullResult.success) {
          Message.error(
            t("git.messages.pullFailed", { error: pullResult.errorType })
          );
          return;
        }
      }

      if (aheadCount > 0) {
        const pushResult = await push();
        if (!pushResult.success) {
          Message.error(
            t("git.messages.pushFailed", { error: pushResult.errorType })
          );
          return;
        }
      }

      if (aheadCount > 0 || behindCount > 0) {
        Message.success(t("git.messages.syncSuccess"));
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      Message.error(t("git.messages.syncFailed", { error: msg }));
    } finally {
      setSyncInProgress(false);
    }
  }, [
    push,
    pull,
    fetch,
    behindCount,
    aheadCount,
    canSyncDisplayedRepo,
    needsPublish,
    handlePublish,
    t,
  ]);

  const isPublishing = isLoading.publish;
  const isSyncBusy =
    isLoading.pull ||
    isLoading.push ||
    isLoading.fetch ||
    syncInProgress ||
    statusLoading ||
    isPublishing;

  const { spinClass: syncSpinClass, handleClick: handleSyncClick } =
    useRefreshSpin(needsPublish ? handlePublish : handleSync, isSyncBusy);

  return {
    workspaceLabel,
    workspaceTooltip,
    isMultiRoot,
    aheadCount,
    behindCount,
    needsPublish: !!needsPublish,
    isSyncBusy,
    isPublishing,
    canSyncDisplayedRepo,
    syncSpinClass,
    handleSyncClick,
    checkoutLoading,
  };
}
