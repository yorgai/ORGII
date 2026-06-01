/**
 * Abyss Theme for CodeMirror 6
 *
 * Based on the VS Code Abyss theme - a deep blue dark theme.
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

// ============================================
// Abyss Theme (Dark only)
// ============================================

export const defaultSettingsAbyss = {
  background: "#000c18",
  foreground: "#6688cc",
  caret: "#ddbb88",
  selection: "#770811",
  selectionMatch: "#770811",
  gutterBackground: "#000c18",
  gutterForeground: "#406385",
  lineHighlight: "#08205080",
};

export const abyssStyle = [
  { tag: t.comment, color: "#384887" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#225588" },
  { tag: [t.string, t.special(t.string)], color: "#22aa44" },
  { tag: [t.number, t.bool, t.null], color: "#f280d0" },
  { tag: t.regexp, color: "#22aa44" },
  { tag: [t.function(t.variableName)], color: "#ddbb88" },
  { tag: t.className, color: "#ffeebb", textDecoration: "underline" },
  { tag: [t.typeName, t.namespace], color: "#9966b8", fontStyle: "italic" },
  { tag: t.variableName, color: "#6688cc" },
  { tag: t.propertyName, color: "#6688cc" },
  { tag: t.self, color: "#2277ff", fontStyle: "italic" },
  { tag: t.attributeName, color: "#ddbb88" },
  { tag: t.tagName, color: "#225588" },
  { tag: t.heading, color: "#6688cc", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#22aa44", fontStyle: "italic" },
  { tag: t.link, color: "#22aa44", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#A22D44" },
  { tag: t.deleted, color: "#dc322f" },
  { tag: t.inserted, color: "#219186" },
  { tag: t.changed, color: "#cb4b16" },
];

export function abyssInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsAbyss, ...settings },
    styles: [...abyssStyle, ...styles],
  });
}

export const abyss = abyssInit();
