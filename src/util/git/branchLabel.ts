/**
 * Formats a raw git branch ref into a human-readable label.
 *
 * Strips the standard ref prefix (`refs/heads/`) and the agent-created
 * branch prefix (`agent/`) that agent-core appends to worktree branches.
 *
 * Use this everywhere a branch name is displayed in the UI — never inline
 * the regex, as omitting the `agent/` strip causes display divergence between
 * the context bar and the sidebar worktree subtitle.
 */
export function formatBranchLabel(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/^refs\/heads\//, "").replace(/^agent\//, "");
}
