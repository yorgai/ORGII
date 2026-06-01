/**
 * Terminal Theme Utilities
 * Converts app themes to XTerm format.
 *
 * Background strategy: xterm owns its background. We resolve --cm-editor-background
 * from the document and pass it as theme.background, matching VSCode's
 * approach. On app theme switches the active terminal's theme is patched
 * via terminal.options.theme = ... (see TerminalInteractive theme effect),
 * so the background tracks the token without recreating the terminal.
 */
import type { ITheme } from "@xterm/xterm";

// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches SidebarModules/Terminal → engines/TerminalCore → this file.
import type { TerminalThemeName } from "@src/store/ui/uiAtom";
import { TERMINAL_THEMES } from "@src/util/ui/terminal/themes";

/** Read --cm-editor-background from documentElement. */
export function getBgColor(themeName: TerminalThemeName): string {
  const fallback = TERMINAL_THEMES[themeName].background;
  if (typeof window === "undefined") return fallback;
  const cssVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--cm-editor-background")
    .trim();
  if (!cssVar || cssVar.startsWith("var(")) return fallback;
  return cssVar;
}

export function getXTermTheme(themeName: TerminalThemeName): ITheme {
  const theme = TERMINAL_THEMES[themeName];
  const bg = getBgColor(themeName);
  return {
    background: bg,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: bg,
    selectionBackground: theme.selection,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}
