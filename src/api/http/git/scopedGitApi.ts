/**
 * Scoped Git API — binds repo_id + repo_path once, so callers
 * don't repeat them on every operation.
 *
 * Used by per-repo source control hooks in multi-root workspaces.
 *
 * Imports directly from staging/commits to avoid circular dependency with index.ts.
 *
 * @example
 * ```typescript
 * const git = createScopedGitApi(repoId, repoPath);
 * await git.stage(["src/main.ts"]);
 * await git.unstage(["src/main.ts"]);
 * await git.discard(["src/main.ts"]);
 * await git.commit("fix: typo");
 * ```
 */
import { gitCommit } from "./commits";
import { gitDiscardChanges, gitStageFiles, gitUnstageFiles } from "./staging";

export interface ScopedGitApi {
  stage: (files: string[]) => Promise<boolean>;
  unstage: (files: string[]) => Promise<boolean>;
  discard: (files: string[]) => Promise<boolean>;
  commit: (message: string) => Promise<unknown>;
}

export function createScopedGitApi(
  repoId: string,
  repoPath: string
): ScopedGitApi {
  return {
    stage: (files) =>
      gitStageFiles({ repo_id: repoId, repo_path: repoPath, files }),

    unstage: (files) =>
      gitUnstageFiles({ repo_id: repoId, repo_path: repoPath, files }),

    discard: (files) =>
      gitDiscardChanges({
        repo_id: repoId,
        repo_path: repoPath,
        files,
      }),

    commit: (message) =>
      gitCommit({ repo_id: repoId, repo_path: repoPath, message }),
  };
}
