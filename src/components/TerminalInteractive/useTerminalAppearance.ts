import type { Terminal } from "@xterm/xterm";
import { type RefObject, useEffect } from "react";

// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches SidebarModules/Terminal → engines/TerminalCore → this file.
import type { TerminalThemeName } from "@src/store/ui/uiAtom";

import { getXTermTheme } from "./utils";

interface UseTerminalAppearanceOptions {
  terminalRef: RefObject<Terminal | null>;
  fitTerminal: () => void;
  isReady: boolean;
  terminalTheme: TerminalThemeName;
  isDarkTheme: boolean;
  terminalFontSize: number;
  terminalLetterSpacing: number;
  codeFontFamily: string;
}

export function useTerminalAppearance({
  terminalRef,
  fitTerminal,
  isReady,
  terminalTheme,
  isDarkTheme,
  terminalFontSize,
  terminalLetterSpacing,
  codeFontFamily,
}: UseTerminalAppearanceOptions): void {
  // Handle theme changes (both terminal theme and app theme).
  // Patches the live xterm instance — same approach as VSCode: swap the
  // theme, drop the WebGL glyph atlas (which cached bitmaps with the old
  // foreground colour), then refresh visible rows.
  useEffect(() => {
    if (terminalRef.current && isReady) {
      const terminal = terminalRef.current;
      terminal.options.theme = getXTermTheme(terminalTheme);
      terminal.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
      requestAnimationFrame(() => {
        fitTerminal();
      });
    }
  }, [terminalTheme, isDarkTheme, isReady, fitTerminal, terminalRef]);

  // Handle font size changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isReady) return;
    terminal.options.fontSize = terminalFontSize;
    terminal.clearTextureAtlas();
    setTimeout(fitTerminal, 50);
  }, [terminalFontSize, isReady, fitTerminal, terminalRef]);

  // Handle letter spacing (character gap) changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isReady) return;
    terminal.options.letterSpacing = terminalLetterSpacing;
    terminal.clearTextureAtlas();
    setTimeout(fitTerminal, 50);
  }, [terminalLetterSpacing, isReady, fitTerminal, terminalRef]);

  // Handle font family changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isReady) return;

    const applyFont = () => {
      terminal.options.fontFamily = codeFontFamily;
      // Clear the WebGL glyph texture atlas so it is rebuilt with the new
      // font.  Without this xterm re-uses cached glyph bitmaps that were
      // measured against the old font, producing misaligned characters.
      terminal.clearTextureAtlas();
      setTimeout(fitTerminal, 50);
    };

    if (typeof document.fonts?.ready === "undefined") {
      applyFont();
    } else {
      document.fonts.ready.then(applyFont);
    }
  }, [codeFontFamily, isReady, fitTerminal, terminalRef]);
}
