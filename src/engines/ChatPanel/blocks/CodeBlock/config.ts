/**
 * Detect language from file path
 */
import { getFileExtensionLower, getFileName } from "@src/util/file/pathUtils";

/**
 * ChatCodeBlock Configuration
 *
 * Language display names and constants for code block display
 * Note: Icons are now handled by the shared FileTypeIcon component
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
// Style Configuration
// ============================================

export const STYLE_CONFIG = {
  /** Default max height for code block */
  defaultMaxHeight: 300,
  /** Minimum height for code block */
  minHeight: 80,
  /** Collapsed height showing only header */
  collapsedHeight: 26,
  /** Border radius */
  borderRadius: 6,
  /** Animation duration in ms */
  animationDuration: 200,
} as const;

// ============================================
// Utility Functions
// ============================================

/**
 * Get display name for a language
 */
export const getLanguageDisplayName = (language: string): string => {
  const lang = language?.toLowerCase() || "default";
  return LANGUAGE_DISPLAY_NAMES[lang] || language || "Code";
};

export const detectLanguageFromPath = (filePath: string): string => {
  if (!filePath) return "text";

  const fileName = getFileName(filePath);

  // Special file names
  const specialFiles: Record<string, string> = {
    Makefile: "makefile",
    Dockerfile: "dockerfile",
    ".gitignore": "text",
    ".env": "env",
    ".bashrc": "bash",
    ".zshrc": "zsh",
  };

  if (specialFiles[fileName]) {
    return specialFiles[fileName];
  }

  const extension = getFileExtensionLower(fileName);
  return extension || "text";
};
