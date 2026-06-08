import {
  compactRepoPathForDisplay,
  pickToolArgString,
} from "@src/util/file/repoPathDisplay";

/**
 * Fallback formatter for unregistered tools only.
 * Built-in tool/action labels must come from the Rust tool registry.
 */
export function formatToolName(toolName: string): string {
  return toolName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Extract the primary "argument" for a tool call — used as secondary text in
 * the simulator sidebar and block headers. Returns just the base name for
 * path-like args (e.g. `/src/App.tsx` → `App.tsx`) so rows stay compact.
 *
 * NOT localized. Callers should treat `undefined` as "no arg to show".
 */
export function formatToolArg(
  toolName: string,
  args: Record<string, unknown> | undefined
): string | undefined {
  if (!args || typeof args !== "object") return undefined;

  const pickString = (...keys: string[]): string | undefined =>
    pickToolArgString(args, ...keys);

  const repoPath = pickString("repo_path", "repoPath");
  const cwd = pickString(
    "cwd",
    "working_dir",
    "workingDir",
    "workingDirectory"
  );

  // File-path tools → repo-aware path so multi-root rows are not ambiguous.
  const pathArg = pickString(
    "file_path",
    "filePath",
    "target_file",
    "targetFile",
    "path"
  );
  if (pathArg)
    return compactRepoPathForDisplay({ path: pathArg, repoPath, cwd });

  // Directory-list tools → repo-aware directory.
  const dirArg = pickString("target_directory", "targetDirectory", "dir");
  if (dirArg) {
    const trimmed = dirArg.replace(/\/+$/, "");
    return trimmed.length > 0
      ? `${compactRepoPathForDisplay({ path: trimmed, repoPath, cwd })}/`
      : "./";
  }

  // Search-style tools → the query/pattern.
  const queryArg = pickString(
    "query",
    "pattern",
    "glob_pattern",
    "globPattern",
    "search_query"
  );
  if (queryArg) return queryArg;

  // Shell-style tools → command keyword.
  const cmdArg = pickString("command", "cmd");
  if (cmdArg) return cmdArg.split(/\s+/)[0];

  // URL-based tools.
  const urlArg = pickString("url", "href");
  if (urlArg) {
    try {
      return new URL(urlArg).hostname || urlArg;
    } catch {
      return urlArg;
    }
  }

  // Action-style tools (LSP, worktree, manage_*). Use the action name itself.
  const actionArg = pickString("action", "kind", "op");
  if (actionArg) return actionArg;

  return undefined;
}
