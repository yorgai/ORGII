import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { MutableRefObject } from "react";

import { ShellIntegrationAddon } from "@src/engines/TerminalCore/addons/ShellIntegrationAddon";
// Direct leaf import to avoid pulling @src/store's barrel — which transitively
// reaches SidebarModules/Terminal → engines/TerminalCore → this file.
import type { TerminalThemeName } from "@src/store/ui/uiAtom";

import type { TerminalViewProps } from "./types";
import { getXTermTheme } from "./utils";

interface CreateTerminalInstanceParams {
  terminalTheme: TerminalThemeName;
  terminalFontSize: number;
  terminalLetterSpacing: number;
  codeFontFamily: string;
  shellIntegration?: TerminalViewProps["shellIntegration"];
}

interface InitializeWhenContainerVisibleParams {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  initTimeoutRef: MutableRefObject<NodeJS.Timeout | null>;
  terminal: Terminal;
  fitTerminal: () => void;
  initPty: (cols: number, rows: number) => void;
  loadWebGL: () => void;
  setIsReady: (value: boolean) => void;
}

export function createTerminalInstance({
  terminalTheme,
  terminalFontSize,
  terminalLetterSpacing,
  codeFontFamily,
  shellIntegration,
}: CreateTerminalInstanceParams) {
  const terminal = new Terminal({
    theme: getXTermTheme(terminalTheme),
    fontSize: terminalFontSize,
    fontFamily: codeFontFamily,
    fontWeight: "400",
    fontWeightBold: "700",
    letterSpacing: terminalLetterSpacing,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorInactiveStyle: "outline",
    scrollback: 5000,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 1,
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  const unicode11Addon = new Unicode11Addon();

  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.loadAddon(serializeAddon);
  terminal.loadAddon(unicode11Addon);
  terminal.loadAddon(new WebLinksAddon());

  if (shellIntegration) {
    terminal.loadAddon(
      new ShellIntegrationAddon({
        onPromptStart: shellIntegration.onPromptStart,
        onCommandExecuted: shellIntegration.onCommandExecuted,
        onCommandFinished: shellIntegration.onCommandFinished,
        onCwdChanged: shellIntegration.onCwdChanged,
      })
    );
  }

  terminal.unicode.activeVersion = "11";

  return {
    terminal,
    fitAddon,
    searchAddon,
    serializeAddon,
  };
}

export function loadTerminalWebgl(
  terminal: Terminal,
  webglAddonRef: MutableRefObject<WebglAddon | null>
) {
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      console.warn("[Terminal] WebGL context lost, falling back to canvas");
      webglAddon.dispose();
      webglAddonRef.current = null;
    });
    terminal.loadAddon(webglAddon);
    webglAddonRef.current = webglAddon;
  } catch (error) {
    console.warn(
      "[Terminal] WebGL addon failed to load, using canvas renderer:",
      error
    );
  }
}

export function initializeWhenContainerVisible({
  containerRef,
  initTimeoutRef,
  terminal,
  fitTerminal,
  initPty,
  loadWebGL,
  setIsReady,
}: InitializeWhenContainerVisibleParams) {
  const checkAndInit = () => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const doInit = () => {
        if (!containerRef.current) return;
        loadWebGL();
        fitTerminal();
        setIsReady(true);
        initPty(terminal.cols, terminal.rows);
        setTimeout(fitTerminal, 150);
        setTimeout(fitTerminal, 300);
      };

      if (typeof document.fonts?.ready === "undefined") {
        doInit();
      } else {
        document.fonts.ready.then(doInit);
      }
    } else {
      initTimeoutRef.current = setTimeout(checkAndInit, 50);
    }
  };

  requestAnimationFrame(() => {
    checkAndInit();
  });
}
