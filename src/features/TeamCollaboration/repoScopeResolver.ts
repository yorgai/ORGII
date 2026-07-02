/**
 * Repo path → scope key resolution (design §8.3, submission side only).
 *
 * When a local checkout has a git remote, the org scope key becomes the
 * NORMALIZED remote URL so differently-located checkouts of the same repo
 * agree on one key; repos without a remote fall back to the normalized
 * absolute path. Resolution happens BEFORE `request_repo_join` /
 * `update_org_repo_scopes` — the approve RPC stores whatever was submitted
 * verbatim, so an unresolved submission would split the scope key space
 * into mixed formats.
 *
 * The remote lookup reuses the existing git HTTP IPC (`getGitRemotes`,
 * Rust server, `repo_id` = filesystem path). It already swallows transport
 * errors and returns `undefined`, so resolution degrades to the path key.
 */
import { getGitRemotes } from "@src/api/http/git/remotes";

import { normalizeRepoScopeKey } from "./collabSyncUtils";

function isLocalRepoPath(value: string): boolean {
  return value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value);
}

export async function resolveRepoScopeKey(input: string): Promise<string> {
  const normalizedInput = normalizeRepoScopeKey(input);
  // Remote-style keys (and anything that is not a local path) pass through
  // already normalized; only local paths can be resolved to a remote.
  if (!normalizedInput || !isLocalRepoPath(normalizedInput)) {
    return normalizedInput;
  }
  const data = await getGitRemotes({ repo_id: normalizedInput });
  const remotes = data?.remotes ?? [];
  const preferred =
    remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  const remoteUrl = preferred?.url || preferred?.fetch_url;
  if (!remoteUrl) return normalizedInput;
  return normalizeRepoScopeKey(remoteUrl) || normalizedInput;
}

/** Batch variant for multi-line scope inputs; dedupes after resolution. */
export async function resolveRepoScopeKeys(
  inputs: string[]
): Promise<string[]> {
  const resolved = await Promise.all(inputs.map(resolveRepoScopeKey));
  return Array.from(new Set(resolved.filter((key) => key.length > 0)));
}
