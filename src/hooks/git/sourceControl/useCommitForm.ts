/**
 * Hook for managing commit form state and submission
 *
 * Uses dispatch() for all git operations to ensure AI/human unification.
 * Gets gitOutputIntegration from atom for commit/stage streaming.
 */
import { useActionSystemOptional } from "@/src/modules/WorkStation/ActionSystem";
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { getGitRemotes } from "@src/api/http/git/remotes";
import { useGitOperations } from "@src/hooks/git/useGitOperations";
import { appendGitCoauthorTrailer } from "@src/services/git/operations/commitAttribution";
import { gitOutputIntegrationAtom } from "@src/store/workstation/codeEditor/outputIntegration";
import type { GitFile } from "@src/types/git/types";
import { showGitActionDialogSafely } from "@src/util/dialogs/gitActionDialog";

export interface CommitSuccessOptions {
  /** Whether push was already performed as part of this operation */
  pushed?: boolean;
}

export interface UseCommitFormOptions {
  selectedRepoId: string | null;
  repoPath?: string;
  files: GitFile[];
  onCommitSuccess?: (options?: CommitSuccessOptions) => void | Promise<void>;
}

export interface UseCommitFormResult {
  commitSummary: string;
  setCommitSummary: Dispatch<SetStateAction<string>>;
  commitDescription: string;
  setCommitDescription: Dispatch<SetStateAction<string>>;
  commitLoading: boolean;
  handleCommit: () => Promise<void>;
  handleCommitAndPush: () => Promise<void>;
  handleCommitAndPublish: () => Promise<void>;
  handleCommitAndSync: () => Promise<void>;
  handleAmend: () => Promise<void>;
  generateLoading: boolean;
  handleGenerateCommitMessage: () => Promise<void>;
}

export function useCommitForm(
  options: UseCommitFormOptions
): UseCommitFormResult {
  const { selectedRepoId, repoPath, files, onCommitSuccess } = options;
  const { t } = useTranslation();

  // Get dispatch for unified operations
  const actionSystem = useActionSystemOptional();
  const dispatch = actionSystem?.dispatch;

  // Get git output integration from atom for commit/stage operations
  const outputIntegration = useAtomValue(gitOutputIntegrationAtom);

  // Use unified git operations for push/pull - auto-streams to Output panel
  const { push, pull, publish } = useGitOperations({
    repoId: selectedRepoId || undefined,
    repoPath,
  });

  const hasConfiguredRemote = useCallback(async (): Promise<boolean> => {
    if (!selectedRepoId) return false;

    const remotesData = await getGitRemotes({
      repo_id: selectedRepoId,
      repo_path: repoPath,
    });
    return (remotesData?.remotes?.length ?? 0) > 0;
  }, [selectedRepoId, repoPath]);

  const showMissingRemoteHint = useCallback(() => {
    showGitActionDialogSafely(t("sourceControl.noRemoteForPublish"), "warning");
  }, [t]);

  const [commitSummary, setCommitSummary] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [commitLoading, setCommitLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);

  const handleGenerateCommitMessage = useCallback(async () => {
    if (!repoPath) return;
    setGenerateLoading(true);
    try {
      const message = await invoke<string>("generate_commit_message", {
        repoPath,
      });
      if (message) {
        setCommitSummary(message);
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error ? error.message : String(error),
        "error"
      );
    } finally {
      setGenerateLoading(false);
    }
  }, [repoPath]);

  const formatCommitMessage = useCallback((message: string): string => {
    return appendGitCoauthorTrailer(message);
  }, []);

  // Commit changes
  const handleCommit = useCallback(async () => {
    if (!selectedRepoId || !commitSummary.trim()) {
      return;
    }

    // Filter files that are already in the git staging area
    const stagedFiles = files.filter((file) => file.staged);

    // Smart Commit:
    // If no staged files, stage all changed files and commit them
    const filesToCommit = stagedFiles.length > 0 ? stagedFiles : files;

    if (filesToCommit.length === 0) {
      showGitActionDialogSafely("No files to commit", "error");
      return;
    }

    setCommitLoading(true);

    try {
      const commitPayload: {
        repo_id: string;
        repo_path?: string;
        message: string;
        description?: string;
        files: string[];
      } = {
        repo_id: selectedRepoId,
        repo_path: repoPath,
        message: formatCommitMessage(commitSummary.trim()),
        files: filesToCommit.map((file) => file.path),
      };

      if (commitDescription.trim()) {
        commitPayload.description = commitDescription.trim();
      }

      // Use streaming if available
      if (outputIntegration && commitPayload.message) {
        // First stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await outputIntegration.stageWithOutput({
            files: files.map((file) => file.path),
          });
        }
        // Then commit with streaming
        await outputIntegration.commitWithOutput({
          message: commitPayload.message,
        });
      } else if (dispatch) {
        // Stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await dispatch(
            "git.stage",
            { paths: files.map((file) => file.path) },
            "user"
          );
        }
        // Then commit via dispatch
        await dispatch(
          "git.commit",
          { message: commitPayload.message },
          "user"
        );
      }

      const wasSmartCommit = stagedFiles.length === 0;
      showGitActionDialogSafely(
        `Successfully committed ${filesToCommit.length} file${filesToCommit.length !== 1 ? "s" : ""}${wasSmartCommit ? " (Smart Commit)" : ""}`,
        "info"
      );

      // Clear commit form
      setCommitSummary("");
      setCommitDescription("");

      // Call success callback
      if (onCommitSuccess) {
        await onCommitSuccess();
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error ? error.message : "Failed to commit changes",
        "error"
      );
    } finally {
      setCommitLoading(false);
    }
  }, [
    selectedRepoId,
    repoPath,
    files,
    commitSummary,
    outputIntegration,
    commitDescription,
    onCommitSuccess,
    formatCommitMessage,
    dispatch,
  ]);

  // Commit & Push - commit changes then push to remote
  const handleCommitAndPush = useCallback(async () => {
    if (!selectedRepoId || !commitSummary.trim()) {
      return;
    }

    // Filter files that are already in the git staging area
    const stagedFiles = files.filter((file) => file.staged);

    // Smart Commit:
    // If no staged files, stage all changed files and commit them
    const filesToCommit = stagedFiles.length > 0 ? stagedFiles : files;

    if (filesToCommit.length === 0) {
      showGitActionDialogSafely("No files to commit", "error");
      return;
    }

    setCommitLoading(true);

    try {
      const commitPayload: {
        repo_id: string;
        repo_path?: string;
        message: string;
        description?: string;
        files: string[];
      } = {
        repo_id: selectedRepoId,
        repo_path: repoPath,
        message: formatCommitMessage(commitSummary.trim()),
        files: filesToCommit.map((file) => file.path),
      };

      if (commitDescription.trim()) {
        commitPayload.description = commitDescription.trim();
      }

      // Use streaming if available for commit/stage
      if (outputIntegration && commitPayload.message) {
        // First stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await outputIntegration.stageWithOutput({
            files: files.map((file) => file.path),
          });
        }
        // Then commit with streaming
        await outputIntegration.commitWithOutput({
          message: commitPayload.message,
        });
      } else if (dispatch) {
        // Stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await dispatch(
            "git.stage",
            { paths: files.map((file) => file.path) },
            "user"
          );
        }
        // Then commit via dispatch
        await dispatch(
          "git.commit",
          { message: commitPayload.message },
          "user"
        );
      }

      // Push using useGitOperations (auto-streams to Output panel)
      const pushResult = await push();
      if (!pushResult.success) {
        throw new Error(`Push failed: ${pushResult.errorType}`);
      }

      const wasSmartCommit = stagedFiles.length === 0;
      showGitActionDialogSafely(
        `Successfully committed and pushed ${filesToCommit.length} file${filesToCommit.length !== 1 ? "s" : ""}${wasSmartCommit ? " (Smart Commit)" : ""}`,
        "info"
      );

      // Clear commit form
      setCommitSummary("");
      setCommitDescription("");

      // Call success callback — push already done, skip optimistic ahead increment
      if (onCommitSuccess) {
        await onCommitSuccess({ pushed: true });
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error
          ? error.message
          : "Failed to commit and push changes",
        "error"
      );
    } finally {
      setCommitLoading(false);
    }
  }, [
    selectedRepoId,
    repoPath,
    files,
    commitSummary,
    outputIntegration,
    commitDescription,
    onCommitSuccess,
    formatCommitMessage,
    push,
    dispatch,
  ]);

  const handleCommitAndPublish = useCallback(async () => {
    if (!selectedRepoId || !commitSummary.trim()) {
      return;
    }

    const stagedFiles = files.filter((file) => file.staged);
    const filesToCommit = stagedFiles.length > 0 ? stagedFiles : files;

    if (filesToCommit.length === 0) {
      showGitActionDialogSafely("No files to commit", "error");
      return;
    }

    if (!(await hasConfiguredRemote())) {
      showMissingRemoteHint();
      return;
    }

    setCommitLoading(true);

    try {
      const commitPayload: {
        repo_id: string;
        repo_path?: string;
        message: string;
        description?: string;
        files: string[];
      } = {
        repo_id: selectedRepoId,
        repo_path: repoPath,
        message: formatCommitMessage(commitSummary.trim()),
        files: filesToCommit.map((file) => file.path),
      };

      if (commitDescription.trim()) {
        commitPayload.description = commitDescription.trim();
      }

      if (outputIntegration && commitPayload.message) {
        if (stagedFiles.length === 0 && files.length > 0) {
          await outputIntegration.stageWithOutput({
            files: files.map((file) => file.path),
          });
        }
        await outputIntegration.commitWithOutput({
          message: commitPayload.message,
        });
      } else if (dispatch) {
        if (stagedFiles.length === 0 && files.length > 0) {
          await dispatch(
            "git.stage",
            { paths: files.map((file) => file.path) },
            "user"
          );
        }
        await dispatch(
          "git.commit",
          { message: commitPayload.message },
          "user"
        );
      }

      const publishResult = await publish();
      if (!publishResult.success) {
        throw new Error(`Publish failed: ${publishResult.errorType}`);
      }

      const wasSmartCommit = stagedFiles.length === 0;
      showGitActionDialogSafely(
        `Successfully committed and published ${filesToCommit.length} file${filesToCommit.length !== 1 ? "s" : ""}${wasSmartCommit ? " (Smart Commit)" : ""}`,
        "info"
      );

      setCommitSummary("");
      setCommitDescription("");

      if (onCommitSuccess) {
        await onCommitSuccess({ pushed: true });
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error
          ? error.message
          : "Failed to commit and publish changes",
        "error"
      );
    } finally {
      setCommitLoading(false);
    }
  }, [
    selectedRepoId,
    repoPath,
    files,
    commitSummary,
    outputIntegration,
    commitDescription,
    onCommitSuccess,
    formatCommitMessage,
    hasConfiguredRemote,
    showMissingRemoteHint,
    publish,
    dispatch,
  ]);

  // Commit & Sync - commit changes, pull, then push
  const handleCommitAndSync = useCallback(async () => {
    if (!selectedRepoId || !commitSummary.trim()) {
      return;
    }

    // Filter files that are already in the git staging area
    const stagedFiles = files.filter((file) => file.staged);

    // Smart Commit:
    // If no staged files, stage all changed files and commit them
    const filesToCommit = stagedFiles.length > 0 ? stagedFiles : files;

    if (filesToCommit.length === 0) {
      showGitActionDialogSafely("No files to commit", "error");
      return;
    }

    setCommitLoading(true);

    try {
      const commitPayload: {
        repo_id: string;
        repo_path?: string;
        message: string;
        description?: string;
        files: string[];
      } = {
        repo_id: selectedRepoId,
        repo_path: repoPath,
        message: formatCommitMessage(commitSummary.trim()),
        files: filesToCommit.map((file) => file.path),
      };

      if (commitDescription.trim()) {
        commitPayload.description = commitDescription.trim();
      }

      // Use streaming if available for commit/stage
      if (outputIntegration && commitPayload.message) {
        // First stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await outputIntegration.stageWithOutput({
            files: files.map((file) => file.path),
          });
        }
        // Then commit with streaming
        await outputIntegration.commitWithOutput({
          message: commitPayload.message,
        });
      } else if (dispatch) {
        // Stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await dispatch(
            "git.stage",
            { paths: files.map((file) => file.path) },
            "user"
          );
        }
        // Then commit via dispatch
        await dispatch(
          "git.commit",
          { message: commitPayload.message },
          "user"
        );
      }

      // Pull using useGitOperations (auto-streams to Output panel)
      const pullResult = await pull();
      if (!pullResult.success) {
        throw new Error(`Pull failed: ${pullResult.errorType}`);
      }

      // Push using useGitOperations (auto-streams to Output panel)
      const pushResult = await push();
      if (!pushResult.success) {
        throw new Error(`Push failed: ${pushResult.errorType}`);
      }

      const wasSmartCommit = stagedFiles.length === 0;
      showGitActionDialogSafely(
        `Successfully committed and synced ${filesToCommit.length} file${filesToCommit.length !== 1 ? "s" : ""}${wasSmartCommit ? " (Smart Commit)" : ""}`,
        "info"
      );

      // Clear commit form
      setCommitSummary("");
      setCommitDescription("");

      // Call success callback — push already done, skip optimistic ahead increment
      if (onCommitSuccess) {
        await onCommitSuccess({ pushed: true });
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error
          ? error.message
          : "Failed to commit and sync changes",
        "error"
      );
    } finally {
      setCommitLoading(false);
    }
  }, [
    selectedRepoId,
    repoPath,
    files,
    commitSummary,
    outputIntegration,
    commitDescription,
    onCommitSuccess,
    formatCommitMessage,
    pull,
    push,
    dispatch,
  ]);

  // Amend previous commit
  const handleAmend = useCallback(async () => {
    if (!selectedRepoId) {
      return;
    }

    // Filter files that are already in the git staging area
    const stagedFiles = files.filter((file) => file.staged);

    // Smart Commit:
    // If no staged files, stage all changed files and commit them
    const filesToAmend = stagedFiles.length > 0 ? stagedFiles : files;

    if (filesToAmend.length === 0 && !commitSummary.trim()) {
      showGitActionDialogSafely("No files or message to amend", "error");
      return;
    }

    setCommitLoading(true);

    try {
      // Use streaming if available
      if (outputIntegration) {
        // First stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await outputIntegration.stageWithOutput({
            files: files.map((file) => file.path),
          });
        }
        // Then amend with streaming (if API supports it)
        // Note: If amendWithOutput doesn't exist, we'll use the regular API
        if (dispatch) {
          await dispatch(
            "git.amend",
            {
              message: commitSummary.trim()
                ? formatCommitMessage(commitSummary.trim())
                : undefined,
            },
            "user"
          );
        }
      } else if (dispatch) {
        // Stage files if needed (smart commit)
        if (stagedFiles.length === 0 && files.length > 0) {
          await dispatch(
            "git.stage",
            { paths: files.map((file) => file.path) },
            "user"
          );
        }
        // Then amend via dispatch
        await dispatch(
          "git.amend",
          {
            message: commitSummary.trim()
              ? formatCommitMessage(commitSummary.trim())
              : undefined,
          },
          "user"
        );
      }

      const wasSmartCommit = stagedFiles.length === 0;
      showGitActionDialogSafely(
        filesToAmend.length > 0
          ? `Successfully amended commit with ${filesToAmend.length} file${filesToAmend.length !== 1 ? "s" : ""}${wasSmartCommit ? " (Smart Commit)" : ""}`
          : "Successfully amended commit message",
        "info"
      );

      // Clear commit form
      setCommitSummary("");
      setCommitDescription("");

      // Call success callback
      if (onCommitSuccess) {
        await onCommitSuccess();
      }
    } catch (error: unknown) {
      showGitActionDialogSafely(
        error instanceof Error ? error.message : "Failed to amend commit",
        "error"
      );
    } finally {
      setCommitLoading(false);
    }
  }, [
    selectedRepoId,
    files,
    commitSummary,
    outputIntegration,
    onCommitSuccess,
    formatCommitMessage,
    dispatch,
  ]);

  return {
    commitSummary,
    setCommitSummary,
    commitDescription,
    setCommitDescription,
    commitLoading,
    handleCommit,
    handleCommitAndPush,
    handleCommitAndPublish,
    handleCommitAndSync,
    handleAmend,
    generateLoading,
    handleGenerateCommitMessage,
  };
}
