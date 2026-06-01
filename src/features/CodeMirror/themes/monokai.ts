/**
 * Monokai Theme for CodeMirror 6
 *
 * Based on the classic Monokai color scheme.
 * Includes both dark and light variants.
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

// ============================================
// Monokai Dark Theme
// ============================================

export const defaultSettingsMonokaiDark = {
  background: "#272822",
  foreground: "#F8F8F2",
  caret: "#F8F8F0",
  selection: "#878B9180",
  selectionMatch: "#575B6180",
  gutterBackground: "#272822",
  gutterForeground: "#90908A",
  lineHighlight: "#3E3D3280",
};

export const monokaiDarkStyle = [
  { tag: [t.comment, t.bracket], color: "#88846F" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#F92672" },
  { tag: [t.string, t.special(t.string)], color: "#E6DB74" },
  { tag: [t.number, t.bool, t.null], color: "#AE81FF" },
  { tag: t.regexp, color: "#E6DB74" },
  { tag: [t.function(t.variableName), t.className], color: "#A6E22E" },
  { tag: [t.typeName, t.namespace], color: "#66D9EF", fontStyle: "italic" },
  { tag: t.variableName, color: "#F8F8F2" },
  { tag: t.propertyName, color: "#F8F8F2" },
  { tag: t.self, color: "#FD971F", fontStyle: "italic" },
  { tag: t.attributeName, color: "#A6E22E" },
  { tag: t.tagName, color: "#F92672" },
  { tag: t.heading, color: "#A6E22E", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#66D9EF", fontStyle: "italic" },
  { tag: t.link, color: "#E6DB74", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#F44747" },
  { tag: t.deleted, color: "#F92672" },
  { tag: t.inserted, color: "#A6E22E" },
  { tag: t.changed, color: "#E6DB74" },
];

export function monokaiDarkInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsMonokaiDark, ...settings },
    styles: [...monokaiDarkStyle, ...styles],
  });
}

export const monokaiDark = monokaiDarkInit();

// ============================================
// Monokai Light Theme
// ============================================

export const defaultSettingsMonokaiLight = {
  background: "#fafafa",
  foreground: "#49483e",
  caret: "#666663",
  selection: "#ccc9ad",
  selectionMatch: "#e6e3c380",
  gutterBackground: "#fafafa",
  gutterForeground: "#a2a19c",
  lineHighlight: "#e6e3c380",
};

export const monokaiLightStyle = [
  { tag: t.comment, color: "#75715E" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#f9005a" },
  { tag: [t.string, t.special(t.string)], color: "#998f2f" },
  { tag: [t.number, t.bool, t.null], color: "#684d99" },
  { tag: t.regexp, color: "#998f2f" },
  { tag: [t.function(t.variableName), t.className], color: "#679c00" },
  { tag: [t.typeName, t.namespace], color: "#0089b3", fontStyle: "italic" },
  { tag: t.variableName, color: "#49483e" },
  { tag: t.propertyName, color: "#49483e" },
  { tag: t.self, color: "#cf7000", fontStyle: "italic" },
  { tag: t.attributeName, color: "#679c00" },
  { tag: t.tagName, color: "#f9005a" },
  { tag: t.heading, color: "#cf7000", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#0089b3", fontStyle: "italic" },
  { tag: t.link, color: "#998f2f", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#F92672", background: "#F8F8F0" },
  { tag: t.deleted, color: "#dc322f" },
  { tag: t.inserted, color: "#219186" },
  { tag: t.changed, color: "#cb4b16" },
];

export function monokaiLightInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "light", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsMonokaiLight, ...settings },
    styles: [...monokaiLightStyle, ...styles],
  });
}

export const monokaiLight = monokaiLightInit();

// ============================================
// Default Aliases (dark variant)
// ============================================
export const defaultSettingsMonokai = defaultSettingsMonokaiDark;
export const monokaiStyle = monokaiDarkStyle;
export const monokaiInit = monokaiDarkInit;
export const monokai = monokaiDark;
