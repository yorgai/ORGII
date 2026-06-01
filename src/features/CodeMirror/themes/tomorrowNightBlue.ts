/**
 * Tomorrow Night Blue Theme for CodeMirror 6
 *
 * Based on the VS Code Tomorrow Night Blue theme.
 */
import { tags as t } from "@lezer/highlight";
import { type CreateThemeOptions, createTheme } from "@uiw/codemirror-themes";

// ============================================
// Tomorrow Night Blue Theme (Dark only)
// ============================================

export const defaultSettingsTomorrowNightBlue = {
  background: "#002451",
  foreground: "#FFFFFF",
  caret: "#FFFFFF",
  selection: "#003f8e",
  selectionMatch: "#003f8e",
  gutterBackground: "#002451",
  gutterForeground: "#7285B7",
  lineHighlight: "#00346e80",
};

export const tomorrowNightBlueStyle = [
  { tag: t.comment, color: "#7285B7" },
  { tag: [t.keyword, t.modifier, t.operatorKeyword], color: "#EBBBFF" },
  { tag: [t.string, t.special(t.string)], color: "#D1F1A9" },
  { tag: [t.number, t.bool, t.null], color: "#FFC58F" },
  { tag: t.regexp, color: "#FF9DA4" },
  { tag: [t.function(t.variableName)], color: "#BBDAFF" },
  { tag: t.className, color: "#FFEEAD" },
  { tag: [t.typeName, t.namespace], color: "#FFEEAD" },
  { tag: t.variableName, color: "#FF9DA4" },
  { tag: t.propertyName, color: "#FFFFFF" },
  { tag: t.attributeName, color: "#FF9DA4" },
  { tag: t.tagName, color: "#FF9DA4" },
  { tag: t.heading, color: "#FFFFFF", fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, color: "#FFC58F", fontStyle: "italic" },
  { tag: t.link, color: "#D1F1A9", textDecoration: "underline" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.invalid, color: "#a92049" },
  { tag: t.deleted, color: "#c82829" },
  { tag: t.inserted, color: "#718c00" },
  { tag: t.changed, color: "#4271ae" },
];

export function tomorrowNightBlueInit(options?: Partial<CreateThemeOptions>) {
  const { theme = "dark", settings = {}, styles = [] } = options || {};
  return createTheme({
    theme,
    settings: { ...defaultSettingsTomorrowNightBlue, ...settings },
    styles: [...tomorrowNightBlueStyle, ...styles],
  });
}

export const tomorrowNightBlue = tomorrowNightBlueInit();
