/**
 * GitHub Theme for CodeMirror 6
 *
 * Integrated with token system for user customization.
 * Syntax colors are defined as CSS variables in the active public theme CSS
 * and referenced directly so theme swaps update the editor without JS copies.
 *
 * Original source: https://github.com/uiwjs/react-codemirror/tree/master/themes/github
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

function cssVar(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

// ============================================
// Default Settings (fallbacks if CSS vars not available)
// ============================================

export const defaultSettingsGithubLight = {
  background: "#fff",
  foreground: "#24292e",
  selection: "#BBDFFF",
  selectionMatch: "#BBDFFF",
  gutterBackground: "#fff",
  gutterForeground: "#6e7781",
};

export const defaultSettingsGithubDark = {
  background: "#0a0a0a",
  foreground: "#c9d1d9",
  caret: "#c9d1d9",
  selection: "#003d73",
  selectionMatch: "#003d73",
  gutterBackground: "#0a0a0a",
  gutterForeground: "#8b949e",
  lineHighlight: "#36334280",
};

// ============================================
// Dynamic Theme Factory (reads CSS variables)
// ============================================

/**
 * Creates a GitHub-style theme using CSS variable tokens.
 * Call this when the theme might have changed (e.g., after settings update).
 */
export function createGithubTheme(
  isDark: boolean
): ReturnType<typeof createTheme> {
  const settings = {
    background: cssVar("--cm-editor-background", isDark ? "#0a0a0a" : "#fff"),
    foreground: cssVar(
      "--cm-editor-foreground",
      isDark ? "#c9d1d9" : "#24292e"
    ),
    selection: cssVar("--cm-editor-selection", isDark ? "#003d73" : "#BBDFFF"),
    selectionMatch: cssVar(
      "--cm-editor-selection",
      isDark ? "#003d73" : "#BBDFFF"
    ),
    gutterBackground: cssVar(
      "--cm-editor-gutter-bg",
      isDark ? "#0a0a0a" : "#fff"
    ),
    gutterForeground: cssVar(
      "--cm-editor-gutter-fg",
      isDark ? "#8b949e" : "#6e7781"
    ),
    lineHighlight: cssVar(
      "--cm-editor-line-highlight",
      isDark ? "#36334280" : "transparent"
    ),
  };

  const keyword = cssVar("--cm-syntax-keyword", isDark ? "#ff7b72" : "#d73a49");
  const string = cssVar("--cm-syntax-string", isDark ? "#a5d6ff" : "#032f62");
  const comment = cssVar("--cm-syntax-comment", isDark ? "#8b949e" : "#6a737d");
  const func = cssVar("--cm-syntax-function", isDark ? "#d2a8ff" : "#6f42c1");
  const variable = cssVar(
    "--cm-syntax-variable",
    isDark ? "#79c0ff" : "#005cc5"
  );
  const tag = cssVar("--cm-syntax-tag", isDark ? "#7ee787" : "#116329");
  const constant = cssVar(
    "--cm-syntax-constant",
    isDark ? "#ffab70" : "#e36209"
  );
  const link = cssVar("--cm-syntax-link", isDark ? "#a5d6ff" : "#032f62");
  const invalid = cssVar("--cm-syntax-invalid", isDark ? "#f97583" : "#cb2431");
  const deleted = cssVar("--cm-syntax-deleted", isDark ? "#ffdcd7" : "#b31d28");
  const deletedBg = cssVar("--cm-syntax-deleted-bg", "#ffeef0");

  const styles = [
    { tag: [t.standard(t.tagName), t.tagName], color: tag },
    { tag: [t.comment, t.bracket], color: comment },
    { tag: [t.className, t.propertyName], color: func },
    {
      tag: [t.variableName, t.attributeName, t.number, t.operator],
      color: variable,
    },
    { tag: [t.keyword, t.typeName, t.typeOperator], color: keyword },
    { tag: [t.string, t.meta, t.regexp], color: string },
    { tag: [t.name, t.quote], color: tag },
    { tag: [t.heading, t.strong], color: func, fontWeight: "bold" },
    { tag: [t.emphasis], color: func, fontStyle: "italic" },
    { tag: [t.deleted], color: deleted, backgroundColor: deletedBg },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: constant },
    { tag: [t.url, t.escape, t.regexp, t.link], color: link },
    { tag: t.link, textDecoration: "underline" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.invalid, color: invalid },
  ];

  return createTheme({
    theme: isDark ? "dark" : "light",
    settings,
    styles,
  });
}

// ============================================
// Static Themes
// These use hardcoded values, use createGithubTheme() for dynamic theming
// ============================================

export const githubLightStyle = [
  { tag: [t.standard(t.tagName), t.tagName], color: "#116329" },
  { tag: [t.comment, t.bracket], color: "#6a737d" },
  { tag: [t.className, t.propertyName], color: "#6f42c1" },
  {
    tag: [t.variableName, t.attributeName, t.number, t.operator],
    color: "#005cc5",
  },
  { tag: [t.keyword, t.typeName, t.typeOperator], color: "#d73a49" },
  { tag: [t.string, t.meta, t.regexp], color: "#032f62" },
  { tag: [t.name, t.quote], color: "#22863a" },
  { tag: [t.heading, t.strong], color: "#24292e", fontWeight: "bold" },
  { tag: [t.emphasis], color: "#24292e", fontStyle: "italic" },
  { tag: [t.deleted], color: "#b31d28", backgroundColor: "#ffeef0" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#e36209" },
  { tag: [t.url, t.escape, t.regexp, t.link], color: "#032f62" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#cb2431" },
];

export const githubDarkStyle = [
  { tag: [t.standard(t.tagName), t.tagName], color: "#7ee787" },
  { tag: [t.comment, t.bracket], color: "#8b949e" },
  { tag: [t.className, t.propertyName], color: "#d2a8ff" },
  {
    tag: [t.variableName, t.attributeName, t.number, t.operator],
    color: "#79c0ff",
  },
  { tag: [t.keyword, t.typeName, t.typeOperator], color: "#ff7b72" },
  { tag: [t.string, t.meta, t.regexp], color: "#a5d6ff" },
  { tag: [t.name, t.quote], color: "#7ee787" },
  { tag: [t.heading, t.strong], color: "#d2a8ff", fontWeight: "bold" },
  { tag: [t.emphasis], color: "#d2a8ff", fontStyle: "italic" },
  { tag: [t.deleted], color: "#ffdcd7", backgroundColor: "#ffeef0" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#ffab70" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#f97583" },
];

export function githubLightInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "light", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsGithubLight, ...settings },
    styles: [...githubLightStyle, ...styles],
  });
}

export function githubDarkInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsGithubDark, ...settings },
    styles: [...githubDarkStyle, ...styles],
  });
}

// Pre-built static themes
export const githubLight = githubLightInit();
export const githubDark = githubDarkInit();
