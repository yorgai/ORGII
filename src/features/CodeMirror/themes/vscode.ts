/**
 * VS Code Theme for CodeMirror 6
 *
 * Based on VS Code's default Dark+ theme (standard token colors).
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

// ============================================
// VS Code Dark Theme
// ============================================

export const defaultSettingsVSCodeDark = {
  background: "#181818",
  foreground: "#D4D4D4",
  caret: "#AEAFAD",
  selection: "#264F78",
  selectionMatch: "#3A3D41",
  gutterBackground: "#181818",
  gutterForeground: "#858585",
  lineHighlight: "#2A2D2E80",
};

export const vscodeDarkStyle = [
  { tag: [t.comment, t.bracket], color: "#6A9955" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#569CD6" },
  { tag: t.controlKeyword, color: "#C586C0" },
  { tag: [t.string, t.special(t.string)], color: "#CE9178" },
  { tag: t.number, color: "#B5CEA8" },
  { tag: t.regexp, color: "#D16969" },
  { tag: t.function(t.variableName), color: "#DCDCAA" },
  { tag: [t.typeName, t.className, t.namespace], color: "#4EC9B0" },
  { tag: t.variableName, color: "#9CDCFE" },
  { tag: t.propertyName, color: "#9CDCFE" },
  { tag: t.tagName, color: "#569CD6" },
  { tag: t.attributeName, color: "#9CDCFE" },
  { tag: [t.heading, t.strong], color: "#569CD6", fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#3794FF", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#F44747" },
];

export function vscodeDarkInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsVSCodeDark, ...settings },
    styles: [...vscodeDarkStyle, ...styles],
  });
}

export const vscodeDark = vscodeDarkInit();

// ============================================
// VS Code Light Theme
// ============================================

export const defaultSettingsVSCodeLight = {
  background: "#FFFFFF",
  foreground: "#000000",
  caret: "#000000",
  selection: "#ADD6FF",
  selectionMatch: "#ADD6FF80",
  gutterBackground: "#FFFFFF",
  gutterForeground: "#237893",
  lineHighlight: "#F5F5F580",
};

export const vscodeLightStyle = [
  { tag: [t.comment, t.bracket], color: "#008000" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#0000FF" },
  { tag: t.controlKeyword, color: "#AF00DB" },
  { tag: [t.string, t.special(t.string)], color: "#A31515" },
  { tag: t.number, color: "#098658" },
  { tag: t.regexp, color: "#811F3F" },
  { tag: t.function(t.variableName), color: "#795E26" },
  { tag: [t.typeName, t.className, t.namespace], color: "#267F99" },
  { tag: t.variableName, color: "#001080" },
  { tag: t.propertyName, color: "#001080" },
  { tag: t.tagName, color: "#800000" },
  { tag: t.attributeName, color: "#FF0000" },
  { tag: [t.heading, t.strong], color: "#0000FF", fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.link, color: "#0000FF", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#CD3131" },
];

export function vscodeLightInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "light", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsVSCodeLight, ...settings },
    styles: [...vscodeLightStyle, ...styles],
  });
}

export const vscodeLight = vscodeLightInit();
