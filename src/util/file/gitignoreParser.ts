/**
 * Gitignore Parser Utility
 *
 * Parses .gitignore files and provides functions to check if files are ignored.
 * Uses the 'ignore' npm package which implements the gitignore spec.
 *
 * Usage:
 *   const ignorer = await createGitignore(repoPath);
 *   const isIgnored = ignorer.ignores("node_modules/package.json"); // true
 */
import { readTextFile } from "@tauri-apps/plugin-fs";
import ignore, { type Ignore } from "ignore";

/**
 * Default patterns that are always ignored (common hidden/system files)
 */
const DEFAULT_IGNORED_PATTERNS = [
  ".git",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
];

/**
 * Load and parse .gitignore file from a repository
 *
 * @param repoPath - Root path of the repository
 * @returns Ignore instance that can check if paths are ignored
 */
export async function createGitignore(repoPath: string): Promise<Ignore> {
  const ignorer = ignore();

  // Add default patterns
  ignorer.add(DEFAULT_IGNORED_PATTERNS);

  try {
    // Try to read .gitignore from repo root
    const gitignorePath = `${repoPath}/.gitignore`;
    const gitignoreContent = await readTextFile(gitignorePath);

    // Parse and add patterns (ignore empty lines and comments)
    const patterns = gitignoreContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    ignorer.add(patterns);
  } catch {
    // .gitignore doesn't exist or can't be read - that's okay
  }

  return ignorer;
}

/**
 * Create a cached gitignore checker for a repository.
 * Returns a function that efficiently checks if paths are ignored.
 *
 * @param repoPath - Root path of the repository
 * @returns Object with `isIgnored` function and `refresh` to reload patterns
 */
export async function createGitignoreChecker(repoPath: string): Promise<{
  isIgnored: (relativePath: string) => boolean;
  refresh: () => Promise<void>;
}> {
  let ignorer = await createGitignore(repoPath);

  return {
    /**
     * Check if a relative path is ignored by .gitignore patterns
     *
     * @param relativePath - Path relative to repo root (e.g., "node_modules/package.json")
     * @returns true if the path is ignored
     */
    isIgnored: (relativePath: string): boolean => {
      // The ignore package expects paths without leading slash
      const normalizedPath = relativePath.startsWith("/")
        ? relativePath.slice(1)
        : relativePath;
      return ignorer.ignores(normalizedPath);
    },

    /**
     * Reload .gitignore patterns from disk
     */
    refresh: async () => {
      ignorer = await createGitignore(repoPath);
    },
  };
}

/**
 * Check if a single path is ignored (one-off check, not cached)
 *
 * @param repoPath - Root path of the repository
 * @param relativePath - Path relative to repo root
 * @returns true if the path is ignored
 */
export async function isPathIgnored(
  repoPath: string,
  relativePath: string
): Promise<boolean> {
  const ignorer = await createGitignore(repoPath);
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return ignorer.ignores(normalizedPath);
}
