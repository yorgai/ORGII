/**
 * CodeMirror Theme Configuration
 *
 * Theme selection, font constants, and base theme extension.
 * Uses CSS variables from _editor-tokens.scss.
 */
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { createGithubTheme } from "../themes";

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
 * Get the app-theme-backed CodeMirror theme.
 */
export function getCodeMirrorTheme(isDark: boolean) {
  return createGithubTheme(isDark);
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
