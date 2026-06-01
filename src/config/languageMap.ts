/**
 * Consolidated Language Map
 *
 * Single source of truth for file extension → language identifier mapping.
 * Used for syntax highlighting, LSP language detection, and code viewer.
 *
 * IMPORTANT: Do not duplicate this map elsewhere. Import from this module.
 */

// ============================================
// File Extension → Language ID
// ============================================

/**
 * Map of file extensions to language identifiers.
 * These identifiers are compatible with:
 * - highlight.js language names
 * - LSP language IDs
 * - CodeMirror language modes
 */
export const LANGUAGE_MAP: Record<string, string> = {
  // TypeScript / JavaScript
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  vue: "vue",
  svelte: "svelte",

  // Python
  py: "python",
  pyi: "python",

  // Ruby
  rb: "ruby",

  // PHP
  php: "php",

  // Java
  java: "java",

  // Kotlin
  kt: "kotlin",
  kts: "kotlin",

  // Scala
  scala: "scala",

  // Go
  go: "go",

  // Rust
  rs: "rust",

  // C / C++
  c: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  h: "c",
  hpp: "cpp",
  hxx: "cpp",

  // C#
  cs: "csharp",

  // Swift
  swift: "swift",

  // Objective-C
  m: "objectivec",
  mm: "objectivec",

  // Data / Config
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  mdx: "mdx",
  txt: "plaintext",

  // Shell
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",

  // Database
  sql: "sql",

  // Build / DevOps
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",
  tf: "hcl",

  // GraphQL / Protobuf
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  prisma: "prisma",

  // Functional Languages
  hs: "haskell",
  elm: "elm",
  clj: "clojure",
  cljs: "clojurescript",
  cljc: "clojure",
  ml: "ocaml",
  mli: "ocaml",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",

  // Scripting
  lua: "lua",
  perl: "perl",
  pl: "perl",
  r: "r",
  dart: "dart",

  // Zig
  zig: "zig",

  // Vim
  vim: "vim",
};

// ============================================
// Utility Functions
// ============================================

/**
 * Get language identifier from file extension (without dot).
 * @param ext - File extension without leading dot (e.g., "ts", "py")
 * @param fallback - Value to return if extension not found (default: undefined)
 */
export function getLanguageFromExtension(
  ext: string,
  fallback?: string
): string | undefined {
  return LANGUAGE_MAP[ext.toLowerCase()] ?? fallback;
}

/**
 * Get language identifier from file path.
 * @param filePath - Full file path or filename
 * @param fallback - Value to return if extension not recognized (default: undefined)
 */
export function getLanguageFromPath(
  filePath: string | undefined | null,
  fallback?: string
): string | undefined {
  if (!filePath) return fallback;
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return LANGUAGE_MAP[ext] ?? fallback;
}

/**
 * Check if a language identifier is recognized.
 */
export function isKnownLanguage(lang: string): boolean {
  return Object.values(LANGUAGE_MAP).includes(lang);
}

// ============================================
// LSP Support (for CodeMirror linter)
// ============================================

/**
 * Languages with LSP servers configured in the Rust backend.
 * The LspClientManager normalizes variants (e.g., scss→css) so
 * each base language shares a single server process.
 */
export const LANGUAGES_WITH_LSP = new Set([
  // Web
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "json",
  "jsonc",
  "vue",
  "svelte",
  // Systems
  "rust",
  "c",
  "cpp",
  "go",
  "zig",
  // JVM
  "java",
  "kotlin",
  "scala",
  // Scripting
  "python",
  "ruby",
  "php",
  "lua",
  "elixir",
  // Apple / Microsoft
  "swift",
  "csharp",
  // Functional
  "haskell",
  "ocaml",
  "clojure",
  "clojurescript",
  // Config / Data
  "yaml",
  "markdown",
  "mdx",
  // Shell / DevOps
  "shellscript",
  "dockerfile",
  "sql",
]);

/**
 * Check if a file has LSP support based on its path.
 */
export function hasLspSupport(filePath: string): boolean {
  const lang = getLanguageFromPath(filePath);
  return lang ? LANGUAGES_WITH_LSP.has(lang) : false;
}
