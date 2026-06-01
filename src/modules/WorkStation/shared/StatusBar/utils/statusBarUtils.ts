import type { DiagnosticHealthState } from "@src/store/workstation/codeEditor/diagnostics";

import type { DiagnosticUiStatus } from "../types";

export const DIAGNOSTIC_STATUS_PRIORITY: Record<string, number> = {
  active: 4,
  initializing: 3,
  failed: 2,
  unavailable: 1,
  unknown: 0,
};

export function getLspBaseLanguage(lang: string): string {
  if (lang.startsWith("typescript")) return "typescript";
  if (lang.startsWith("javascript")) return "javascript";
  if (lang === "scss" || lang === "sass" || lang === "less") return "css";
  if (lang === "jsonc") return "json";
  if (lang === "mdx") return "markdown";
  if (lang === "clojurescript") return "clojure";
  return lang;
}

/**
 * Collapses the per-language LSP status map down to one row per base
 * language (TypeScript+TSX → "typescript", SCSS/Sass/Less → "css", …),
 * keeping the highest-priority status when multiple flavors of the same
 * base exist. Used by both the language-service status counter and the
 * editor status bar's panel rendering, so the de-dup rules stay in
 * one place.
 */
export function mergeLspByBaseLanguage(
  health: DiagnosticHealthState
): Map<string, { status: string; lang: string }> {
  const merged = new Map<string, { status: string; lang: string }>();
  for (const [lang, info] of health.lsp) {
    const base = getLspBaseLanguage(lang);
    const existing = merged.get(base);
    if (
      !existing ||
      (DIAGNOSTIC_STATUS_PRIORITY[info.status] ?? 0) >
        (DIAGNOSTIC_STATUS_PRIORITY[existing.status] ?? 0)
    ) {
      merged.set(base, { status: info.status, lang: base });
    }
  }
  return merged;
}

export function getLanguageFromPath(filePath?: string): string {
  if (!filePath) return "Plain Text";

  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "Plain Text";

  const languageMap: Record<string, string> = {
    js: "JavaScript",
    mjs: "JavaScript",
    cjs: "JavaScript",
    jsx: "JavaScript React",
    ts: "TypeScript",
    tsx: "TypeScript React",
    py: "Python",
    java: "Java",
    cpp: "C++",
    cc: "C++",
    cxx: "C++",
    c: "C",
    h: "C/C++ Header",
    hpp: "C++ Header",
    rs: "Rust",
    go: "Go",
    html: "HTML",
    htm: "HTML",
    css: "CSS",
    scss: "SCSS",
    sass: "Sass",
    less: "Less",
    json: "JSON",
    md: "Markdown",
    markdown: "Markdown",
    yaml: "YAML",
    yml: "YAML",
    xml: "XML",
    sql: "SQL",
    sh: "Shell",
    bash: "Bash",
    zsh: "Zsh",
    ps1: "PowerShell",
    rb: "Ruby",
    php: "PHP",
    swift: "Swift",
    kt: "Kotlin",
    scala: "Scala",
    lua: "Lua",
    r: "R",
    toml: "TOML",
    ini: "INI",
    env: "Environment",
    dockerfile: "Dockerfile",
    makefile: "Makefile",
    vue: "Vue",
    svelte: "Svelte",
  };

  const filename = filePath.split("/").pop()?.toLowerCase() || "";
  if (filename === "dockerfile") return "Dockerfile";
  if (filename === "makefile") return "Makefile";
  if (filename.startsWith(".env")) return "Environment";

  return languageMap[ext] || "Plain Text";
}

export function countActiveLanguageServiceSources(
  health: DiagnosticHealthState
): number {
  const mergedLsp = mergeLspByBaseLanguage(health);
  let count = 0;
  for (const [, entry] of mergedLsp) {
    if (entry.status === "active") count++;
  }
  if (health.eslint?.status === "active") count++;
  return count;
}

export function diagnosticStatusToUi(status: string): DiagnosticUiStatus {
  if (status === "active") return "active";
  if (status === "initializing") return "initializing";
  if (status === "failed") return "failed";
  return "unknown";
}

export function diagnosticSourceStatusLabel(
  status: string,
  translate: (key: string) => string
): string {
  switch (status) {
    case "active":
      return translate("common:status.connected");
    case "initializing":
      return translate("common:status.loading");
    case "failed":
      return translate("common:status.failed");
    case "unavailable":
      return translate("common:status.unavailable");
    default:
      return translate("common:status.unknown");
  }
}
