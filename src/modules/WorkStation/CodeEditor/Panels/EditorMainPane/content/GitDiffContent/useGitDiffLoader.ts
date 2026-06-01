/**
 * Self-fetch fallback for missing diff content.
 *
 * When the user opens a single-file `git-diff` tab via Source Control and
 * then switches the sidebar away (Search, Extensions, etc.),
 * `useSourceControlState` unmounts. Its `useDiffCache` effect — the only
 * wiring that turns `oldContent: undefined` into real content for working-
 * tree diffs — stops running. The diff tab in the editor pane is then stuck
 * with `gitFile.oldContent === undefined` forever.
 *
 * This hook makes `GitDiffContent` self-sufficient: if it sees a non-timeline
 * diff whose content is missing, it issues its own batch-diff fetch and caches
 * the result locally, keyed by file path.
 */
import { useEffect, useMemo, useState } from "react";

import { getGitBatchFileDiffs } from "@src/api/http/git";
import type { GitFile } from "@src/types/git/types";
import { diffBaseRefForFile } from "@src/util/git/diffBaseRef";

interface FetchedDiff {
  path: string;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
  isBinarySentinel: boolean;
}

interface UseGitDiffLoaderOptions {
  gitFile: GitFile | null;
  repoPath: string;
}

interface UseGitDiffLoaderResult {
  /** The gitFile merged with self-fetched content (when needed). */
  effectiveGitFile: GitFile | null;
  /** True while a self-fetch is in flight. */
  selfFetching: boolean;
}

export function useGitDiffLoader({
  gitFile,
  repoPath,
}: UseGitDiffLoaderOptions): UseGitDiffLoaderResult {
  const [fetchedDiff, setFetchedDiff] = useState<FetchedDiff | null>(null);
  const [selfFetching, setSelfFetching] = useState(false);

  // Reset cached diff when file path changes.
  useEffect(() => {
    setFetchedDiff(null);
  }, [gitFile?.path]);

  useEffect(() => {
    if (!gitFile || !repoPath) return;
    if (gitFile.oldContent !== undefined) return;
    // Timeline diffs are keyed by tab id and are populated synchronously by
    // `handleTimelineCommitClick`; a working-tree fetch would be wrong.
    if (gitFile.id?.startsWith("timeline:")) return;
    if (fetchedDiff?.path === gitFile.path) return;

    let cancelled = false;
    setSelfFetching(true);
    const selfFetchRepoPath = gitFile.repoRoot ?? repoPath;
    const selfFetchRelPath = gitFile.path.startsWith(selfFetchRepoPath + "/")
      ? gitFile.path.slice(selfFetchRepoPath.length + 1)
      : gitFile.path;

    getGitBatchFileDiffs({
      repo_id: selfFetchRepoPath,
      repo_path: selfFetchRepoPath,
      files: [
        {
          path: selfFetchRelPath,
          original_path: gitFile.original_path ?? undefined,
        },
      ],
      // Untracked files (status="added" + !staged) have no HEAD baseline;
      // `diffBaseRefForFile` returns "EMPTY" so the backend flips
      // include_untracked(true) — without this, content stays blank for
      // newly created files even though numstat reports +N additions.
      from_ref: diffBaseRefForFile(gitFile),
      include_content: true,
      context_lines: 3,
    })
      .then((response) => {
        if (cancelled) return;
        const diff = response?.files?.[0];
        if (!diff) {
          setFetchedDiff({
            path: gitFile.path,
            oldContent: "",
            newContent: "",
            additions: 0,
            deletions: 0,
            isBinarySentinel: false,
          });
          return;
        }
        if (diff.binary) {
          setFetchedDiff({
            path: gitFile.path,
            oldContent: "Binary file - content not displayed",
            newContent: "Binary file - content not displayed",
            additions: 0,
            deletions: 0,
            isBinarySentinel: true,
          });
          return;
        }
        setFetchedDiff({
          path: gitFile.path,
          oldContent: diff.old_content ?? "",
          newContent: diff.new_content ?? "",
          additions: diff.insertions ?? 0,
          deletions: diff.deletions ?? 0,
          isBinarySentinel: false,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[GitDiffContent] Self-fetch failed:", error);
        setFetchedDiff({
          path: gitFile.path,
          oldContent: "",
          newContent: "",
          additions: 0,
          deletions: 0,
          isBinarySentinel: false,
        });
      })
      .finally(() => {
        if (!cancelled) setSelfFetching(false);
      });

    return () => {
      cancelled = true;
    };
    // We intentionally depend on the narrow set of fields that determine
    // whether a fetch is needed, not on the full gitFile reference, to avoid
    // re-firing whenever the parent passes a new object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gitFile?.path,
    gitFile?.oldContent,
    gitFile?.id,
    gitFile?.original_path,
    gitFile?.status,
    gitFile?.staged,
    repoPath,
    fetchedDiff?.path,
  ]);

  // Effective gitFile = prop ∪ self-fetched override (when prop content is missing).
  const effectiveGitFile = useMemo<GitFile | null>(() => {
    if (!gitFile) return null;
    if (gitFile.oldContent !== undefined) return gitFile;
    if (fetchedDiff && fetchedDiff.path === gitFile.path) {
      return {
        ...gitFile,
        oldContent: fetchedDiff.oldContent,
        newContent: fetchedDiff.newContent,
        additions: fetchedDiff.additions,
        deletions: fetchedDiff.deletions,
      };
    }
    return gitFile;
  }, [gitFile, fetchedDiff]);

  return { effectiveGitFile, selfFetching };
}
