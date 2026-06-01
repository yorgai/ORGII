/**
 * Path and display helpers for CodePanel search rows.
 */

export function getBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1]! : filePath;
}

export function pickWorkspaceRootForFile(
  filePath: string,
  hint?: string
): string | undefined {
  if (!hint?.trim()) return undefined;
  const normalizedFile = filePath.replace(/\\/g, "/");
  const candidates = hint
    .split(",")
    .map((segment) => segment.trim().replace(/\\/g, "/").replace(/\/$/, ""))
    .filter(Boolean);
  const matching = candidates
    .filter((root) => normalizedFile.startsWith(root))
    .sort((a, b) => b.length - a.length);
  return matching[0];
}

/**
 * Path for display: prefer `repoName/relative/...` using workspace hint or `/.../GitHub/` marker.
 */
export function toRepoFirstDisplayPath(
  absolutePath: string,
  workspaceHint?: string
): string {
  const normalized = absolutePath.replace(/\\/g, "/");
  const root = pickWorkspaceRootForFile(normalized, workspaceHint);
  if (root) {
    const rel = normalized.slice(root.length).replace(/^\//, "");
    const repoName = root.split("/").filter(Boolean).pop() ?? "";
    return repoName ? `${repoName}/${rel}` : rel;
  }

  const githubIdx = normalized.toLowerCase().indexOf("/github/");
  if (githubIdx !== -1) {
    return normalized.slice(githubIdx + "/github/".length).replace(/^\//, "");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return absolutePath;
  if (parts.length <= 6) return parts.join("/");
  return parts.slice(-6).join("/");
}

export function getDirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

export function searchSnippetOneLine(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}
