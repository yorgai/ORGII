/**
 * Solarized Theme for CodeMirror 6
 *
 * Based on Ethan Schoonover's Solarized color scheme.
 * Includes both dark and light variants.
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

// ============================================
// Solarized Dark Theme
// ============================================

export const defaultSettingsSolarizedDark = {
  background: "#002B36",
  foreground: "#839496",
  caret: "#D30102",
  selection: "#274642",
  selectionMatch: "#274642",
  gutterBackground: "#002B36",
  gutterForeground: "#586E75",
  lineHighlight: "#07364280",
};

export const solarizedDarkStyle = [
  { tag: t.comment, color: "#586E75", fontStyle: "italic" },
  { tag: [t.keyword, t.operatorKeyword], color: "#859900" },
  { tag: [t.string, t.special(t.string)], color: "#2AA198" },
  { tag: t.regexp, color: "#DC322F" },
  { tag: [t.number, t.bool, t.null], color: "#D33682" },
  { tag: [t.function(t.variableName), t.className], color: "#268BD2" },
  { tag: [t.typeName, t.namespace], color: "#CB4B16" },
  { tag: t.variableName, color: "#268BD2" },
  { tag: t.propertyName, color: "#839496" },
  { tag: t.attributeName, color: "#93A1A1" },
  { tag: t.tagName, color: "#268BD2" },
  { tag: t.heading, color: "#268BD2", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#D33682", fontStyle: "italic" },
  { tag: t.link, color: "#2AA198", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#DC322F" },
  { tag: t.deleted, color: "#DC322F" },
  { tag: t.inserted, color: "#859900" },
  { tag: t.changed, color: "#CB4B16" },
];

export function solarizedDarkInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsSolarizedDark, ...settings },
    styles: [...solarizedDarkStyle, ...styles],
  });
}

export const solarizedDark = solarizedDarkInit();

// ============================================
// Solarized Light Theme
// ============================================

export const defaultSettingsSolarizedLight = {
  background: "#FDF6E3",
  foreground: "#657B83",
  caret: "#657B83",
  selection: "#EEE8D5",
  selectionMatch: "#EEE8D5",
  gutterBackground: "#FDF6E3",
  gutterForeground: "#93A1A1",
  lineHighlight: "#EEE8D580",
};

export const solarizedLightStyle = [
  { tag: t.comment, color: "#93A1A1", fontStyle: "italic" },
  { tag: [t.keyword, t.operatorKeyword], color: "#859900" },
  { tag: [t.string, t.special(t.string)], color: "#2AA198" },
  { tag: t.regexp, color: "#DC322F" },
  { tag: [t.number, t.bool, t.null], color: "#D33682" },
  { tag: [t.function(t.variableName), t.className], color: "#268BD2" },
  { tag: [t.typeName, t.namespace], color: "#CB4B16" },
  { tag: t.variableName, color: "#268BD2" },
  { tag: t.propertyName, color: "#657B83" },
  { tag: t.attributeName, color: "#93A1A1" },
  { tag: t.tagName, color: "#268BD2" },
  { tag: t.heading, color: "#268BD2", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#D33682", fontStyle: "italic" },
  { tag: t.link, color: "#2AA198", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#DC322F" },
  { tag: t.deleted, color: "#DC322F" },
  { tag: t.inserted, color: "#859900" },
  { tag: t.changed, color: "#CB4B16" },
];

export function solarizedLightInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "light", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsSolarizedLight, ...settings },
    styles: [...solarizedLightStyle, ...styles],
  });
}

export const solarizedLight = solarizedLightInit();
