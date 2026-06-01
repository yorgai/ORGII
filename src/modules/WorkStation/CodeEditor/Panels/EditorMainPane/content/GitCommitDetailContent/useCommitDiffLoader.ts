import { useCallback, useEffect, useState } from "react";

import { getGitCommitDiff } from "@src/api/http/git/diff";
import type { CommitDiffResult } from "@src/api/http/git/types";
import { decodeOctalPath } from "@src/util/file/pathUtils";

type CommitLoadState = "loading" | "ready" | "error" | "no-files";

interface UseCommitDiffLoaderParams {
  commitSha: string;
  repoId: string;
  repoPath: string;
  isRepoReady: boolean;
}

interface UseCommitDiffLoaderResult {
  commitDiff: CommitDiffResult | null;
  commitLoadState: CommitLoadState;
  commitError: string | null;
  selectedFilePath: string | null;
  setSelectedFilePath: (path: string | null) => void;
  reloadCommit: () => void;
}

/**
 * Fetches the commit diff (file list + stats) for a given commit SHA.
 * Automatically selects the first file when the diff loads successfully.
 */
export function useCommitDiffLoader({
  commitSha,
  repoId,
  repoPath,
  isRepoReady,
}: UseCommitDiffLoaderParams): UseCommitDiffLoaderResult {
  const [commitDiff, setCommitDiff] = useState<CommitDiffResult | null>(null);
  const [commitLoadState, setCommitLoadState] =
    useState<CommitLoadState>("loading");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [commitReloadKey, setCommitReloadKey] = useState(0);

  const reloadCommit = useCallback(() => {
    setCommitReloadKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchDiff = async () => {
      if (!repoId || !repoPath || !isRepoReady) return;

      // eslint-disable-next-line no-console
      console.debug("[GitCommitDetailContent] commit_load_start", {
        commitSha,
        repoId,
      });
      setCommitLoadState("loading");
      setCommitError(null);
      setCommitDiff(null);
      setSelectedFilePath(null);

      try {
        const result = await getGitCommitDiff({
          repo_id: repoId,
          repo_path: repoPath,
          commit_sha: commitSha,
        });

        if (cancelled) return;

        if (!result) {
          // eslint-disable-next-line no-console
          console.warn("[GitCommitDetailContent] commit_load_empty", {
            commitSha,
          });
          setCommitLoadState("error");
          setCommitError(`commit=${commitSha}`);
          return;
        }

        setCommitDiff(result);

        const files = result.files ?? [];
        if (files.length === 0) {
          // eslint-disable-next-line no-console
          console.debug("[GitCommitDetailContent] commit_load_no_files", {
            commitSha,
          });
          setCommitLoadState("no-files");
          return;
        }

        // eslint-disable-next-line no-console
        console.debug("[GitCommitDetailContent] commit_load_ready", {
          commitSha,
          fileCount: files.length,
        });
        setCommitLoadState("ready");
        setSelectedFilePath(decodeOctalPath(files[0].file_path));
      } catch (err) {
        if (!cancelled) {
          // eslint-disable-next-line no-console
          console.error("[GitCommitDetailContent] commit_load_error", {
            commitSha,
            error: err,
          });
          setCommitLoadState("error");
          setCommitError(
            err instanceof Error ? err.message : `commit=${commitSha}`
          );
        }
      }
    };

    fetchDiff();
    return () => {
      cancelled = true;
    };
  }, [commitSha, repoId, repoPath, isRepoReady, commitReloadKey]);

  return {
    commitDiff,
    commitLoadState,
    commitError,
    selectedFilePath,
    setSelectedFilePath,
    reloadCommit,
  };
}
