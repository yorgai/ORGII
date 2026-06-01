/**
 * Language Display Names and Mappings
 *
 * Extracted from ChatCodeBlock/config.ts for reuse across components.
 * Provides consistent language display names and special file mappings.
 */

// ============================================
// Language Display Names
// ============================================

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TypeScript React",
  jsx: "JavaScript React",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  vue: "Vue",
  svelte: "Svelte",
  python: "Python",
  py: "Python",
  java: "Java",
  kotlin: "Kotlin",
  scala: "Scala",
  go: "Go",
  rust: "Rust",
  ruby: "Ruby",
  rb: "Ruby",
  php: "PHP",
  csharp: "C#",
  cs: "C#",
  cpp: "C++",
  c: "C",
  swift: "Swift",
  objectivec: "Objective-C",
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  zsh: "Zsh",
  powershell: "PowerShell",
  ps1: "PowerShell",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  toml: "TOML",
  ini: "INI",
  env: "ENV",
  sql: "SQL",
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  mongodb: "MongoDB",
  graphql: "GraphQL",
  markdown: "Markdown",
  md: "Markdown",
  tex: "TeX",
  latex: "LaTeX",
  docker: "Docker",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  cmake: "CMake",
  nginx: "Nginx",
  apache: "Apache",
  diff: "Diff",
  patch: "Patch",
  text: "Plain Text",
  default: "Code",
} as const;

// ============================================
// Special File Name Mappings
// ============================================

/**
 * Maps specific filenames to languages
 * (e.g., Makefile, Dockerfile, .gitignore)
 */
export const SPECIAL_FILENAMES: Record<string, string> = {
  Makefile: "makefile",
  Dockerfile: "dockerfile",
  ".gitignore": "text",
  ".env": "env",
  ".bashrc": "bash",
  ".zshrc": "zsh",
  ".vimrc": "vim",
  ".npmrc": "text",
  ".eslintrc": "json",
  ".prettierrc": "json",
  "tsconfig.json": "json",
  "package.json": "json",
  "composer.json": "json",
} as const;

// ============================================
// Language Icon Mapping (for FileTypeIcon)
// ============================================

/** Maps language names (case-insensitive) to representative filenames for FileTypeIcon. Matches Rust collector's detect_language output. */
const LANGUAGE_ICON_FILE: Record<string, string> = {
  typescript: "file.ts",
  "typescript react": "file.tsx",
  ts: "file.ts",
  tsx: "file.tsx",
  javascript: "file.js",
  "javascript react": "file.jsx",
  js: "file.js",
  jsx: "file.jsx",
  python: "file.py",
  py: "file.py",
  rust: "file.rs",
  go: "file.go",
  html: "file.html",
  css: "file.css",
  scss: "file.scss",
  sass: "file.sass",
  less: "file.less",
  json: "file.json",
  yaml: "file.yaml",
  yml: "file.yml",
  markdown: "file.md",
  md: "file.md",
  ruby: "file.rb",
  rb: "file.rb",
  java: "file.java",
  kotlin: "file.kt",
  php: "file.php",
  swift: "file.swift",
  c: "file.c",
  cpp: "file.cpp",
  "c/c++ header": "file.hpp",
  csharp: "file.cs",
  cs: "file.cs",
  shell: "file.sh",
  bash: "file.sh",
  sh: "file.sh",
  toml: "file.toml",
  sql: "file.sql",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  vue: "file.vue",
  svelte: "file.svelte",
  scala: "file.scala",
  lua: "file.lua",
  makefile: "Makefile",
  graphql: "file.graphql",
  r: "file.r",
  dart: "file.dart",
  elixir: "file.ex",
  erlang: "file.erl",
  haskell: "file.hs",
  ocaml: "file.ml",
  clojure: "file.clj",
  terraform: "file.tf",
  astro: "file.astro",
  powershell: "file.ps1",
  xml: "file.xml",
};

/**
 * Get representative filename for a language (for FileTypeIcon).
 * Used in language distribution, coding profile, etc.
 *
 * @param language - Language name from API (e.g. "TypeScript", "Python", "Unknown")
 * @returns Filename string for FileTypeIcon (e.g. "file.ts", "file.py")
 */
export function getLanguageIconFile(language: string): string {
  const key = language?.toLowerCase().trim() || "";
  return LANGUAGE_ICON_FILE[key] ?? "file.txt";
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get display name for a language code
 *
 * @param language - Language code (e.g., "typescript", "py")
 * @returns Human-readable language name
 *
 * @example
 * getLanguageDisplayName("typescript") // "TypeScript"
 * getLanguageDisplayName("py") // "Python"
 * getLanguageDisplayName("unknown") // "unknown" (unchanged)
 */
export function getLanguageDisplayName(language: string): string {
  const lang = language?.toLowerCase() || "default";
  return LANGUAGE_DISPLAY_NAMES[lang] || language || "Code";
}
