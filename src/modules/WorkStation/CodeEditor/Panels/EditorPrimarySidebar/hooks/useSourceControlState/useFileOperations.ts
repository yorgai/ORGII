/**
 * useFileOperations Hook
 *
 * Handles file-level git operations: stage, unstage, discard.
 * Includes both individual and bulk operations.
 *
 * NOW USES DISPATCH FOR ALL OPERATIONS - achieving true UI/AI unification.
 *
 * The dispatch calls go through GitOperationsService which:
 * - Uses streaming output to Output panel (when available)
 * - Provides identical behavior for human clicks, AI commands, and Spotlight
 */
import { remove } from "@tauri-apps/plugin-fs";
import { type Dispatch, type SetStateAction, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useActionSystemOptional } from "@src/ActionSystem";
import { createLogger } from "@src/hooks/logger";
import type { GitFile } from "@src/types/git/types";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

const log = createLogger("useFileOperations");

export interface UseFileOperationsOptions {
  gitFiles: GitFile[];
  setGitFiles: Dispatch<SetStateAction<GitFile[]>>;
  selectedRepoId: string | null;
  repoPath: string;
  fetchGitStatus: () => Promise<void>;
  gitOutputIntegration: {
    stageWithOutput: (params: { files: string[] }) => Promise<unknown>;
  } | null;
}

export interface UseFileOperationsResult {
  handleStageToggle: (fileId: string, stage: boolean) => Promise<void>;
  handleDiscard: (fileId: string) => Promise<void>;
  handleDiscardFiles: (fileIds: string[]) => Promise<void>;
  handleStageAll: () => Promise<void>;
  handleUnstageAll: () => Promise<void>;
  handleDiscardAll: () => Promise<void>;
  handleOpenChanges: () => void;
  handleOpenStagedChanges: () => void;
  handleStageResolved: (fileId: string) => Promise<void>;
}

export function useFileOperations(
  options: UseFileOperationsOptions
): UseFileOperationsResult {
  const { t } = useTranslation();
  const {
    gitFiles,
    setGitFiles,
    repoPath,
    fetchGitStatus,
    gitOutputIntegration,
  } = options;

  // Get dispatch for GUI actions - this is the ONLY way we execute operations
  const actionSystem = useActionSystemOptional();
  const dispatch = actionSystem?.dispatch;

  // Handle stage/unstage toggle - uses dispatch for unified behavior
  const handleStageToggle = useCallback(
    async (fileId: string, stage: boolean) => {
      const file = gitFiles.find((fileItem) => fileItem.id === fileId);
      if (!file) return;

      if (!dispatch) {
        log.warn(
          "[useFileOperations] No dispatch available - cannot stage/unstage"
        );
        return;
      }

      try {
        // Optimistically update UI
        setGitFiles((prevFiles) =>
          prevFiles.map((fileItem) =>
            fileItem.id === fileId ? { ...fileItem, staged: stage } : fileItem
          )
        );

        // Use dispatch - goes through GitOperationsService
        if (stage) {
          await dispatch("git.stage", { paths: [file.path] }, "user");
        } else {
          await dispatch("git.unstage", { paths: [file.path] }, "user");
        }
      } catch (error) {
        log.error("Failed to stage/unstage file:", error);
        // Revert optimistic update on error
        setGitFiles((prevFiles) =>
          prevFiles.map((fileItem) =>
            fileItem.id === fileId ? { ...fileItem, staged: !stage } : fileItem
          )
        );
      }
    },
    [gitFiles, setGitFiles, dispatch]
  );

  // Handle discard individual file - uses dispatch for unified behavior
  const handleDiscard = useCallback(
    async (fileId: string) => {
      const file = gitFiles.find((fileItem) => fileItem.id === fileId);
      if (!file) return;

      if (!dispatch) {
        log.warn("[useFileOperations] No dispatch available - cannot discard");
        return;
      }

      const fileName = file.path.split("/").pop() || file.path;
      const confirmed = await confirmDestructiveAction({
        title: t("workstation.discardChanges"),
        message: t("workstation.discardChangesConfirm", { files: fileName }),
        okLabel: t("workstation.discardChanges"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;

      try {
        // Untracked files (status "added" + not staged) can't be reverted via git —
        // delete from disk instead (matches VSCode behavior)
        const isUntracked = file.status === "added" && !file.staged;
        if (isUntracked) {
          const absolutePath = file.path.startsWith("/")
            ? file.path
            : `${repoPath}/${file.path}`;
          await remove(absolutePath);
        } else {
          await dispatch("git.discard", { path: file.path }, "user");
        }
        await fetchGitStatus();
      } catch (error) {
        log.error("Failed to discard file changes:", error);
      }
    },
    [gitFiles, repoPath, fetchGitStatus, dispatch, t]
  );

  const handleDiscardFiles = useCallback(
    async (fileIds: string[]) => {
      const files = gitFiles.filter((file) => fileIds.includes(file.id));
      if (files.length === 0) return;

      if (!dispatch) {
        log.warn("[useFileOperations] No dispatch available - cannot discard");
        return;
      }

      const fileText =
        files.length === 1 ? files[0].path : `${files.length} files`;
      const confirmed = await confirmDestructiveAction({
        title: t("workstation.discardChanges"),
        message: t("workstation.discardChangesConfirm", { files: fileText }),
        okLabel: t("workstation.discardChanges"),
        cancelLabel: t("actions.cancel"),
      });
      if (!confirmed) return;

      try {
        const untrackedFiles = files.filter(
          (file) => file.status === "added" && !file.staged
        );
        const trackedFiles = files.filter(
          (file) => !(file.status === "added" && !file.staged)
        );

        await Promise.all(
          untrackedFiles.map((file) => {
            const absolutePath = file.path.startsWith("/")
              ? file.path
              : `${repoPath}/${file.path}`;
            return remove(absolutePath);
          })
        );

        await Promise.all(
          trackedFiles.map((file) =>
            dispatch("git.discard", { path: file.path }, "user")
          )
        );
        await fetchGitStatus();
      } catch (error) {
        log.error("Failed to discard file changes:", error);
      }
    },
    [gitFiles, repoPath, fetchGitStatus, dispatch, t]
  );

  // Handle stage all unstaged files - uses dispatch for unified behavior
  const handleStageAll = useCallback(async () => {
    const unstagedFiles = gitFiles.filter((file) => !file.staged);
    if (unstagedFiles.length === 0) return;

    if (!dispatch) {
      log.warn("[useFileOperations] No dispatch available - cannot stage all");
      return;
    }

    try {
      // Optimistically update UI
      setGitFiles((prevFiles) =>
        prevFiles.map((file) =>
          !file.staged ? { ...file, staged: true } : file
        )
      );

      // Use dispatch - goes through GitOperationsService
      await dispatch(
        "git.stage",
        { paths: unstagedFiles.map((file) => file.path) },
        "user"
      );
    } catch (error) {
      log.error("Failed to stage all files:", error);
      await fetchGitStatus();
    }
  }, [gitFiles, setGitFiles, fetchGitStatus, dispatch]);

  // Handle unstage all staged files - uses dispatch for unified behavior
  const handleUnstageAll = useCallback(async () => {
    const stagedFiles = gitFiles.filter((file) => file.staged);
    if (stagedFiles.length === 0) return;

    if (!dispatch) {
      log.warn(
        "[useFileOperations] No dispatch available - cannot unstage all"
      );
      return;
    }

    try {
      // Optimistically update UI
      setGitFiles((prevFiles) =>
        prevFiles.map((file) =>
          file.staged ? { ...file, staged: false } : file
        )
      );

      // Use dispatch - goes through GitOperationsService
      await dispatch(
        "git.unstage",
        { paths: stagedFiles.map((file) => file.path) },
        "user"
      );
    } catch (error) {
      log.error("Failed to unstage all files:", error);
      await fetchGitStatus();
    }
  }, [gitFiles, setGitFiles, fetchGitStatus, dispatch]);

  // Handle discard all changes - uses dispatch for unified behavior
  const handleDiscardAll = useCallback(async () => {
    const unstagedFiles = gitFiles.filter((file) => !file.staged);
    if (unstagedFiles.length === 0) return;

    if (!dispatch) {
      log.warn(
        "[useFileOperations] No dispatch available - cannot discard all"
      );
      return;
    }

    const fileCount = unstagedFiles.length;
    const _fileText = fileCount === 1 ? "1 file" : `${fileCount} files`;
    const confirmed = await confirmDestructiveAction({
      title: t("workstation.discardChanges"),
      message: t("workstation.discardAllUnstagedConfirm"),
      okLabel: t("workstation.discardChanges"),
      cancelLabel: t("actions.cancel"),
    });
    if (!confirmed) return;

    try {
      const untrackedFiles = unstagedFiles.filter(
        (file) => file.status === "added" && !file.staged
      );
      const trackedFiles = unstagedFiles.filter(
        (file) => !(file.status === "added" && !file.staged)
      );

      await Promise.all(
        untrackedFiles.map((file) => {
          const absolutePath = file.path.startsWith("/")
            ? file.path
            : `${repoPath}/${file.path}`;
          return remove(absolutePath);
        })
      );

      if (trackedFiles.length > 0) {
        await dispatch("git.discardAll", {}, "user");
      }
      await fetchGitStatus();
    } catch (error) {
      log.error("Failed to discard all changes:", error);
    }
  }, [gitFiles, repoPath, fetchGitStatus, dispatch, t]);

  // Handle open all changes view — drives the unified Source Control tab
  // into All Changes mode for unstaged files.
  const handleOpenChanges = useCallback(() => {
    const unstagedFiles = gitFiles.filter((file) => !file.staged);
    if (unstagedFiles.length === 0) return;

    const event = new CustomEvent("open-source-control", {
      detail: { staged: false, files: unstagedFiles },
    });
    document.dispatchEvent(event);
  }, [gitFiles]);

  // Handle open all staged changes view — drives the unified Source Control
  // tab into All Changes mode for staged files.
  const handleOpenStagedChanges = useCallback(() => {
    const stagedFiles = gitFiles.filter((file) => file.staged);
    if (stagedFiles.length === 0) return;

    const event = new CustomEvent("open-source-control", {
      detail: { staged: true, files: stagedFiles },
    });
    document.dispatchEvent(event);
  }, [gitFiles]);

  // Handle staging a resolved conflict file - uses dispatch for unified behavior
  const handleStageResolved = useCallback(
    async (fileId: string) => {
      const file = gitFiles.find((fileItem) => fileItem.id === fileId);
      if (!file) return;

      if (!dispatch) {
        log.warn(
          "[useFileOperations] No dispatch available - cannot stage resolved"
        );
        // Fallback to gitOutputIntegration if available
        if (gitOutputIntegration) {
          try {
            await gitOutputIntegration.stageWithOutput({ files: [file.path] });
            await fetchGitStatus();
          } catch (error) {
            log.error("Failed to stage resolved file:", error);
          }
        }
        return;
      }

      try {
        // Use dispatch - goes through GitOperationsService
        await dispatch("git.stage", { paths: [file.path] }, "user");
        await fetchGitStatus();
      } catch (error) {
        log.error("Failed to stage resolved file:", error);
      }
    },
    [gitFiles, fetchGitStatus, gitOutputIntegration, dispatch]
  );

  return {
    handleStageToggle,
    handleDiscard,
    handleDiscardFiles,
    handleStageAll,
    handleUnstageAll,
    handleDiscardAll,
    handleOpenChanges,
    handleOpenStagedChanges,
    handleStageResolved,
  };
}
