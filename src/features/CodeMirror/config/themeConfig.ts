/**
 * CodeMirror Theme Configuration
 *
 * Theme selection, font constants, and base theme extension.
 * Uses CSS variables from _editor-tokens.scss.
 */
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { EditorTheme } from "@src/store/ui/editorSettingsAtom";

import {
  abyss,
  createGithubTheme,
  githubDark,
  githubLight,
  monokaiDark,
  monokaiLight,
  solarizedDark,
  solarizedLight,
  tomorrowNightBlue,
  vscodeDark,
  vscodeLight,
} from "../themes";

// ============================================
// Font Configuration
// Uses CSS variables from _editor-tokens.scss
// ============================================

export const CODE_FONT_FAMILY = "var(--cm-font-family)";
export const CODE_FONT_SIZE = "var(--cm-font-size)";
export const CODE_FONT_SIZE_SMALL = "var(--cm-font-size-small)";
export const CODE_LINE_HEIGHT = "var(--cm-line-height)";

// ============================================
// Centralized Theme
// ============================================

/**
 * Get a CodeMirror theme based on theme name and dark/light mode.
 *
 * @param isDark - Whether to use dark theme variant
 * @param themeName - Theme name: "github", "vscode", or "monokai"
 * @param dynamic - If true, reads CSS variables for GitHub theme (default: false)
 */
export function getCodeMirrorTheme(
  isDark: boolean,
  themeName: EditorTheme = "github",
  dynamic = false
) {
  switch (themeName) {
    case "vscode":
      return isDark ? vscodeDark : vscodeLight;
    case "monokai":
      return isDark ? monokaiDark : monokaiLight;
    case "solarized":
      return isDark ? solarizedDark : solarizedLight;
    case "abyss":
      // Abyss is dark-only, use GitHub light for light mode
      return isDark ? abyss : githubLight;
    case "tomorrowNightBlue":
      // Tomorrow Night Blue is dark-only, use GitHub light for light mode
      return isDark ? tomorrowNightBlue : githubLight;
    case "github":
    default:
      if (dynamic) {
        return createGithubTheme(isDark);
      }
      return isDark ? githubDark : githubLight;
  }
}

// ============================================
// Theme Extension
// ============================================

/**
 * Creates a consistent theme extension for CodeMirror
 */
export function createCodeMirrorTheme(_isDark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: CODE_FONT_SIZE,
        fontFamily: CODE_FONT_FAMILY,
        backgroundColor: "var(--cm-editor-background)",
      },
      ".cm-scroller": {
        fontFamily: CODE_FONT_FAMILY,
        lineHeight: CODE_LINE_HEIGHT,
        overflow: "auto",
      },
      ".cm-content": {
        fontFamily: CODE_FONT_FAMILY,
      },
      ".cm-gutters": {
        fontFamily: CODE_FONT_FAMILY,
        borderRight: "none",
        border: "none",
        backgroundColor:
          "var(--cm-editor-gutter-bg, var(--cm-editor-background))",
      },
      ".cm-lineNumbers": {
        borderRight: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        borderRight: "none",
      },
      ".cm-line": {
        padding:
          "0 var(--cm-line-padding-right, 16px) 0 var(--cm-line-padding-left, 12px)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      // Remove panels top background and border
      ".cm-panels-top": {
        background: "transparent",
        backgroundColor: "transparent",
        border: "none",
        borderBottom: "none",
      },
      "& .cm-panels-top": {
        background: "transparent",
        backgroundColor: "transparent",
        border: "none",
        borderBottom: "none",
      },
    },
    { dark: _isDark }
  );
}
