/**
 * Git terminology constants — do not translate.
 *
 * These are standard git command names and source-control labels
 * recognized universally across all locales (like VS Code).
 * Keep them as English string literals so they never pass through i18n.
 */

export const GIT_LABELS = {
  // Git commands (single-word verbs)
  push: "Push",
  pull: "Pull",
  fetch: "Fetch",
  commit: "Commit",
  publish: "Publish",

  // Compound command labels (buttons / menu items)
  commitAmend: "Commit (Amend)",
  commitAndPush: "Commit & Push",
  commitAndPublish: "Commit & Publish",
  commitAndSync: "Commit & Sync",
  commitStaged: "Commit Staged",
  commitAll: "Commit All",
  syncChanges: "Sync",
  fetchOrigin: "Fetch Origin",

  // Progress indicators
  pulling: "Pulling...",
  pushing: "Pushing...",
  fetching: "Fetching...",
  syncing: "Syncing...",

  // Section headers
  changes: "Changes",
  stagedChanges: "Staged Changes",
  mergeChanges: "Merge Changes",
  stashes: "Stashes",

  // File action labels
  stageChanges: "Stage Changes",
  unstageChanges: "Unstage Changes",
  discardChanges: "Discard Changes",
  discardAllChanges: "Discard All Changes",
  stashAllChanges: "Stash All Changes",
  openChanges: "Open Changes",
  openStagedChanges: "Open Staged Changes",
  markAsResolved: "Mark as Resolved (Stage)",
  acceptCurrentChange: "Accept Current Change (Ours)",
  acceptIncomingChange: "Accept Incoming Change (Theirs)",

  // Suggestion card labels
  createPR: "Create PR: Merge",
  publishRepository: "Publish repo",
  viewStash: "View Stash",
} as const;

/** Format "Push N commit(s)" / "Pull N commit(s)" */
export function formatCommitCount(
  verb: "Push" | "Pull",
  count: number
): string {
  return `${verb} ${count} commit${count === 1 ? "" : "s"}`;
}

/** Format "Commit N file(s)" / "Commit all N file(s)" */
export function formatCommitFileCount(
  variant: "staged" | "all",
  count: number
): string {
  const suffix = count === 1 ? "file" : "files";
  return variant === "all"
    ? `Commit all ${count} ${suffix}`
    : `Commit ${count} ${suffix}`;
}

export function formatCommitAndPublishFileCount(
  variant: "staged" | "all",
  count: number
): string {
  const suffix = count === 1 ? "file" : "files";
  return variant === "all"
    ? `Commit & Publish all ${count} ${suffix}`
    : `Commit & Publish ${count} ${suffix}`;
}
