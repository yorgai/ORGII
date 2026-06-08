import { getFileName } from "./pathUtils";

export interface RepoPathDisplayInput {
  path?: string;
  repoPath?: string;
  cwd?: string;
  rootLabel?: string;
}

export interface RepoPathDisplayParts {
  normalizedPath: string;
  normalizedRoot?: string;
  rootLabel?: string;
  relativePath?: string;
  displayPath: string;
  title: string;
}

const WINDOWS_ABSOLUTE_RE = /^[A-Za-z]:\//;

export function normalizeDisplayPath(path: string | undefined): string {
  return (path ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_RE.test(path);
}

function stripTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

function pathInsideRoot(path: string, root: string): boolean {
  const normalizedRoot = stripTrailingSlash(root);
  return path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
}

function defaultRootLabel(root: string): string {
  const parts = root.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return getFileName(root) || root;
}

function toTildePath(path: string): string {
  const home = normalizeDisplayPath(
    typeof process !== "undefined" ? process.env?.HOME : undefined
  );
  if (home && path.startsWith(`${stripTrailingSlash(home)}/`)) {
    return `~/${path.slice(stripTrailingSlash(home).length + 1)}`;
  }
  return path;
}

export function formatRepoPathForDisplay(
  input: RepoPathDisplayInput
): RepoPathDisplayParts {
  const normalizedPath = normalizeDisplayPath(input.path);
  const normalizedRepo = stripTrailingSlash(
    normalizeDisplayPath(input.repoPath)
  );
  const normalizedCwd = stripTrailingSlash(normalizeDisplayPath(input.cwd));
  const normalizedRoot = normalizedRepo || normalizedCwd || undefined;
  const rootLabel =
    input.rootLabel ||
    (normalizedRoot ? defaultRootLabel(normalizedRoot) : undefined);

  if (!normalizedPath) {
    return {
      normalizedPath,
      normalizedRoot,
      rootLabel,
      displayPath: "",
      title: "",
    };
  }

  if (!isAbsolutePath(normalizedPath)) {
    const displayPath = rootLabel
      ? `${rootLabel}/${normalizedPath}`
      : normalizedPath;
    return {
      normalizedPath,
      normalizedRoot,
      rootLabel,
      relativePath: normalizedPath,
      displayPath,
      title: normalizedRoot
        ? `${normalizedRoot}/${normalizedPath}`
        : normalizedPath,
    };
  }

  if (normalizedRoot && pathInsideRoot(normalizedPath, normalizedRoot)) {
    const relativePath =
      normalizedPath === normalizedRoot
        ? ""
        : normalizedPath.slice(normalizedRoot.length + 1);
    const displayPath =
      relativePath && rootLabel
        ? `${rootLabel}/${relativePath}`
        : rootLabel || normalizedPath;
    return {
      normalizedPath,
      normalizedRoot,
      rootLabel,
      relativePath,
      displayPath,
      title: normalizedPath,
    };
  }

  const displayPath = toTildePath(normalizedPath);
  return {
    normalizedPath,
    normalizedRoot,
    rootLabel,
    displayPath,
    title: normalizedPath,
  };
}

export function compactRepoPathForDisplay(input: RepoPathDisplayInput): string {
  return formatRepoPathForDisplay(input).displayPath;
}
