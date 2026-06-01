/**
 * Resolve the correct `from_ref` to send to the batch-diff API for a given
 * `GitFile`. Untracked files have no base in `HEAD`, so we must signal this
 * to the backend with the sentinel `"EMPTY"` — that flips
 * `is_empty_base` → true → `diff_opts.include_untracked(true)`, which is what
 * makes git2's `diff_tree_to_workdir_with_index` actually emit a delta (and
 * therefore content) for the untracked path.
 *
 * Without this, an untracked file silently returns empty `old_content` and
 * `new_content` while `additions`/`deletions` come from a separate numstat
 * pass — so the UI shows "+N -M" but the diff body is blank.
 *
 * Frontend convention (see `src/config/gitStatus.ts`):
 *   - "untracked" status from git is normalized to `status: "added"` with
 *     `staged: false` (matches VS Code's "U" letter convention).
 *   - A staged "added" file (`status: "added", staged: true`) IS in the index
 *     and therefore HEAD-vs-WORKDIR comparison still works the normal way.
 */
import type { GitFile } from "@src/types/git/types";

/** Returns true when the file is an untracked working-tree file. */
export function isUntrackedGitFile(
  file: Pick<GitFile, "status" | "staged">
): boolean {
  return file.status === "added" && !file.staged;
}

/**
 * `from_ref` to use for batch-diff calls. Defaults to `"HEAD"`; switches to
 * `"EMPTY"` for untracked files so backend's `include_untracked(true)` path
 * fires and content is actually returned.
 */
export function diffBaseRefForFile(
  file: Pick<GitFile, "status" | "staged">
): "HEAD" | "EMPTY" {
  return isUntrackedGitFile(file) ? "EMPTY" : "HEAD";
}
