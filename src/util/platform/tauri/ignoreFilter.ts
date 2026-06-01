/**
 * Ignore Filter for File Operations
 *
 * Determines which files/directories should be ignored during file operations.
 *
 * NOTE: For better performance, prefer using the native Rust implementation:
 * - import { shouldIgnorePath, filterIgnoredPaths } from "@src/util/platform/tauri/fileUtils"
 *
 * This TypeScript implementation serves as a fallback when Tauri is unavailable.
 */

const BLACKLIST_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "node_modules",
  ".next",
  ".nuxt",
  ".turbo",
  ".parcel-cache",
  "target",
  ".gradle",
  ".m2",
  "out",
  ".idea",
  ".vscode",
  ".vs",
  ".DS_Store",
  "Thumbs.db",
  ".cache",
  ".tmp",
  "tmp",
  "temp",
]);

const BLACKLIST_EXTENSIONS = new Set([
  ".pyc",
  ".pyo",
  ".pyd",
  ".class",
  ".o",
  ".obj",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".a",
  ".lib",
  ".zip",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".rar",
  ".7z",
  ".jar",
  ".war",
  ".ear",
  ".swp",
  ".swo",
  ".bak",
  ".orig",
  ".sqlite",
  ".db",
  ".sqlite3",
]);

const DOTFILE_WHITELIST = new Set([
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".stylelintrc",
  ".stylelintrc.json",
  ".babelrc",
  ".babelrc.json",
  ".browserslistrc",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  ".python-version",
  ".ruby-version",
  ".tool-versions",
  ".dockerignore",
  ".clang-format",
  ".clang-tidy",
  ".rustfmt.toml",
  ".flake8",
  ".pylintrc",
  ".isort.cfg",
  ".pre-commit-config.yaml",
  ".env.example",
  ".env.template",
  ".env.sample",
  ".gitlab-ci.yml",
  ".travis.yml",
  ".markdownlint.json",
  ".markdownlintrc",
]);

const WHITELIST_DIRS = new Set([".github", ".circleci", ".cargo"]);

const HARD_BLOCKED = new Set([
  ".git",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
  ".env.test.local",
  ".secrets",
  ".aws",
  ".ssh",
  ".gnupg",
  ".netrc",
]);

export function shouldIgnore(
  relativePath: string,
  gitignorePatterns?: string[]
): boolean {
  const parts = relativePath.split(/[/\\]/);
  const filename = parts[parts.length - 1];

  for (const part of parts) {
    if (HARD_BLOCKED.has(part)) return true;
  }

  if (DOTFILE_WHITELIST.has(filename)) return false;
  for (const part of parts) {
    if (WHITELIST_DIRS.has(part)) return false;
  }

  if (filename.startsWith(".")) return true;

  for (const part of parts) {
    if (BLACKLIST_DIRS.has(part)) return true;
  }

  for (const ext of BLACKLIST_EXTENSIONS) {
    if (filename.endsWith(ext)) return true;
  }

  if (gitignorePatterns) {
    for (const pattern of gitignorePatterns) {
      if (matchGitignorePattern(relativePath, pattern)) return true;
    }
  }

  return false;
}

const MAX_GITIGNORE_CACHE = 200;
const gitignoreRegexCache = new Map<string, RegExp | null>();

function matchGitignorePattern(path: string, pattern: string): boolean {
  if (!pattern || pattern.startsWith("#") || pattern.startsWith("!")) {
    return false;
  }

  let regex = gitignoreRegexCache.get(pattern);
  if (regex === undefined) {
    let regexPattern = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]");

    if (pattern.endsWith("/")) {
      regexPattern = `(^|/)${regexPattern.slice(0, -1)}(/|$)`;
    } else {
      regexPattern = `(^|/)${regexPattern}$`;
    }

    try {
      regex = new RegExp(regexPattern);
    } catch {
      regex = null;
    }

    if (gitignoreRegexCache.size >= MAX_GITIGNORE_CACHE) {
      const firstKey = gitignoreRegexCache.keys().next().value;
      if (firstKey !== undefined) gitignoreRegexCache.delete(firstKey);
    }
    gitignoreRegexCache.set(pattern, regex);
  }

  return regex ? regex.test(path) : false;
}
