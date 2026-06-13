import { useCallback, useEffect, useState } from "react";

import { getGitFileContent } from "@src/api/http/git/diff";
import type { CommitDiffResult } from "@src/api/http/git/types";
import { createLogger } from "@src/hooks/logger";
import { decodeOctalPath } from "@src/util/file/pathUtils";

const log = createLogger("GitCommitDetailContent");

type FileLoadState = "idle" | "loading" | "ready" | "error";

interface UseCommitFileDiffLoaderParams {
  commitSha: string;
  repoId: string;
  repoPath: string;
  isRepoReady: boolean;
  selectedFilePath: string | null;
  commitDiff: CommitDiffResult | null;
}

interface UseCommitFileDiffLoaderResult {
  fileOldContent: string;
  fileNewContent: string;
  selectedFileIsBinary: boolean;
  fileLoadState: FileLoadState;
  fileError: string | null;
  reloadFile: () => void;
}

/**
 * Fetches the old and new file content for the selected file within a commit.
 * Re-fetches automatically when `selectedFilePath` or `commitDiff` changes.
 */
export function useCommitFileDiffLoader({
  commitSha,
  repoId,
  repoPath,
  isRepoReady,
  selectedFilePath,
  commitDiff,
}: UseCommitFileDiffLoaderParams): UseCommitFileDiffLoaderResult {
  const [fileOldContent, setFileOldContent] = useState<string>("");
  const [fileNewContent, setFileNewContent] = useState<string>("");
  const [selectedFileIsBinary, setSelectedFileIsBinary] = useState(false);
  const [fileLoadState, setFileLoadState] = useState<FileLoadState>("idle");
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileReloadKey, setFileReloadKey] = useState(0);

  const reloadFile = useCallback(() => {
    setFileReloadKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!selectedFilePath || !repoId || !commitDiff || !isRepoReady) {
      return;
    }

    const fileInfo = (commitDiff.files ?? []).find(
      (file) => decodeOctalPath(file.file_path) === selectedFilePath
    );

    if (!fileInfo) {
      log.warn("[GitCommitDetailContent] file_not_in_commit_payload", {
        commitSha,
        selectedFilePath,
      });
      return;
    }

    const parentSha = commitDiff.parent_sha;
    const oldRef = parentSha ?? "none";
    const newRef = commitSha;

    const fetchContent = async () => {
      log.debug("[GitCommitDetailContent] file_load_start", {
        commitSha,
        selectedFilePath,
      });
      setFileLoadState("loading");
      setFileError(null);

      try {
        const [oldResult, newResult] = await Promise.all([
          // No old content for added files or initial commits (no parent)
          fileInfo?.status === "added" || !parentSha
            ? Promise.resolve(undefined)
            : getGitFileContent({
                repo_id: repoId,
                repo_path: repoPath,
                file_path: selectedFilePath,
                ref: parentSha,
              }),
          // No new content for deleted files
          fileInfo?.status === "deleted"
            ? Promise.resolve(undefined)
            : getGitFileContent({
                repo_id: repoId,
                repo_path: repoPath,
                file_path: selectedFilePath,
                ref: commitSha,
              }),
        ]);

        if (cancelled) return;

        const expectedOld = fileInfo.status !== "added" && Boolean(parentSha);
        const expectedNew = fileInfo.status !== "deleted";
        const oldFailed = expectedOld && !oldResult;
        const newFailed = expectedNew && !newResult;

        if (oldFailed || newFailed) {
          log.warn("[GitCommitDetailContent] file_load_partial_failure", {
            selectedFilePath,
            oldRef,
            newRef,
            oldFailed,
            newFailed,
          });
          setFileLoadState("error");
          setFileError(
            `Failed to load content for ${selectedFilePath} (old_ref=${oldRef}, new_ref=${newRef}, old_failed=${String(oldFailed)}, new_failed=${String(newFailed)})`
          );
          return;
        }

        const isBinaryEncoding =
          oldResult?.encoding === "base64" || newResult?.encoding === "base64";
        log.debug("[GitCommitDetailContent] file_load_ready", {
          selectedFilePath,
          isBinaryEncoding,
        });
        setSelectedFileIsBinary(isBinaryEncoding);
        setFileOldContent(oldResult?.content ?? "");
        setFileNewContent(newResult?.content ?? "");
        setFileLoadState("ready");
      } catch (err) {
        if (!cancelled) {
          log.error("[GitCommitDetailContent] file_load_error", {
            selectedFilePath,
            oldRef,
            newRef,
            error: err,
          });
          setFileLoadState("error");
          setFileError(
            err instanceof Error
              ? err.message
              : `Failed to load content for ${selectedFilePath} (old_ref=${oldRef}, new_ref=${newRef})`
          );
        }
      }
    };

    fetchContent();
    return () => {
      cancelled = true;
    };
  }, [
    selectedFilePath,
    repoId,
    repoPath,
    commitSha,
    commitDiff,
    isRepoReady,
    fileReloadKey,
  ]);

  return {
    fileOldContent,
    fileNewContent,
    selectedFileIsBinary,
    fileLoadState,
    fileError,
    reloadFile,
  };
}
