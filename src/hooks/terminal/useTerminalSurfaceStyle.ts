/**
 * Maps user terminal settings (theme + typography atoms) to inline styles
 * for plain DOM "terminal-like" surfaces (e.g. Simulator replay) without xterm.
 */
import { useAtomValue } from "jotai";
import { type CSSProperties, useMemo } from "react";

import { resolvedCodeFontFamilyAtom } from "@src/store/ui/editorSettingsAtom";
// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches SidebarModules/Terminal → engines/TerminalCore → this file's consumers.
import {
  terminalFontSizeAtom,
  terminalLetterSpacingAtom,
  terminalThemeAtom,
} from "@src/store/ui/uiAtom";
import { TERMINAL_THEMES } from "@src/util/ui/terminal/themes";

export interface TerminalSurfaceStyle {
  background: string;
  foreground: string;
  mutedForeground: string;
  errorForeground: string;
  /** Terminal panel font size (px), same atom as xterm / TerminalCore */
  terminalFontSize: number;
  typography: CSSProperties;
}

export function useTerminalSurfaceStyle(): TerminalSurfaceStyle {
  const terminalThemeName = useAtomValue(terminalThemeAtom);
  const terminalFontSize = useAtomValue(terminalFontSizeAtom);
  const terminalLetterSpacing = useAtomValue(terminalLetterSpacingAtom);
  const codeFontFamily = useAtomValue(resolvedCodeFontFamilyAtom);
  return useMemo(() => {
    const palette = TERMINAL_THEMES[terminalThemeName];
    const typography: CSSProperties = {
      fontFamily: codeFontFamily,
      fontSize: terminalFontSize,
      letterSpacing: terminalLetterSpacing,
      lineHeight: 1.45,
    };

    return {
      background: palette.background,
      foreground: palette.foreground,
      mutedForeground: palette.brightBlack,
      errorForeground: palette.red,
      terminalFontSize,
      typography,
    };
  }, [
    codeFontFamily,
    terminalFontSize,
    terminalLetterSpacing,
    terminalThemeName,
  ]);
}
