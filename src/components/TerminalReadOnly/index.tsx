/**
 * TerminalReadOnly Component
 *
 * Read-only xterm.js terminal for displaying agent session output.
 * Receives output from three sources:
 * - Session events: eventsAtom (primary — same reliable source the simulator uses)
 * - Subprocess streaming: `agent-exec-output` CustomEvent (real-time supplement)
 * - PTY mirror: `pty-output-osagent-pty-main` Tauri event (for interactive commands)
 *
 * No user input forwarding — purely a display component.
 */
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { isThemeCssPathDark } from "@src/config/appearance/globalThemes";
import { eventsAtom } from "@src/engines/SessionCore/core/atoms";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { isShellTool } from "@src/engines/SessionCore/sync/adapters/shared";
import {
  terminalFontSizeAtom,
  terminalLetterSpacingAtom,
  terminalThemeAtom,
  themesAtom,
} from "@src/store";
import { resolvedCodeFontFamilyAtom } from "@src/store/ui/editorSettingsAtom";
import { listenTauri } from "@src/util/platform/tauri/init";

import "../TerminalInteractive/index.scss";
import {
  ANSI_RED,
  ANSI_RESET,
  formatSystemChunk,
  getXTermTheme,
} from "../TerminalInteractive/utils";

/** Safe text extraction — handles string, {content:…}, etc. */
function safeStr(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.text === "string") return obj.text;
  }
  return undefined;
}

/** Extract shell command + output from a SessionEvent (same logic as Simulator). */
function extractShellFromEvent(event: SessionEvent): {
  command: string;
  output?: string;
  exitCode?: number;
} {
  const { args, result } = event;

  // Nested output.success / output.failure handling
  const outputObj = result?.output as Record<string, unknown> | undefined;
  const nestedSuccess = (outputObj?.success as Record<string, unknown>) || {};
  const directSuccess = (result?.success as Record<string, unknown>) || {};
  const successData =
    Object.keys(nestedSuccess).length > 0 ? nestedSuccess : directSuccess;

  const nestedFailure = (outputObj?.failure as Record<string, unknown>) || {};
  const directFailure = (result?.failure as Record<string, unknown>) || {};
  const failureData =
    Object.keys(nestedFailure).length > 0 ? nestedFailure : directFailure;

  const commandData =
    Object.keys(successData).length > 0 ? successData : failureData;

  const command =
    (commandData?.command as string) ||
    (args?.command as string) ||
    (result?.command as string) ||
    "";

  const shellOutput =
    safeStr(commandData?.interleavedOutput) ||
    safeStr(commandData?.interleaved_output) ||
    safeStr(commandData?.stdout) ||
    safeStr(result?.stdout) ||
    safeStr(commandData?.stderr) ||
    safeStr(result?.stderr) ||
    (typeof result?.output === "string"
      ? (result.output as string)
      : undefined) ||
    safeStr(result?.observation) ||
    safeStr(result?.content) ||
    undefined;

  const exitCode =
    (commandData?.exitCode as number) ??
    (commandData?.exit_code as number) ??
    (result?.exit_code as number) ??
    undefined;

  return { command, output: shellOutput, exitCode };
}

// ============================================
// Props
// ============================================

export interface TerminalReadOnlyProps {
  /** Agent session ID to subscribe to (e.g., "osagent-1770647800087") */
  agentSessionId: string;
}

// ============================================
// Component
// ============================================

interface PtyOutputPayload {
  bytes?: number[];
  byte_count?: number;
  data?: string;
}

const PTY_SESSION_ID = "osagent-pty-main";
const MAX_WRITTEN_IDS = 500;

const TerminalReadOnly: React.FC<TerminalReadOnlyProps> = ({
  agentSessionId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const _searchAddonRef = useRef<SearchAddon | null>(null);
  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isReady, setIsReady] = useState(false);
  const terminalTheme = useAtomValue(terminalThemeAtom);
  const terminalFontSize = useAtomValue(terminalFontSizeAtom);
  const terminalLetterSpacing = useAtomValue(terminalLetterSpacingAtom);
  const codeFontFamily = useAtomValue(resolvedCodeFontFamilyAtom);
  const appTheme = useAtomValue(themesAtom);
  const isDarkTheme = isThemeCssPathDark(appTheme);

  // Keep agentSessionId in a ref so event listeners don't go stale
  const agentSessionIdRef = useRef(agentSessionId);
  useEffect(() => {
    agentSessionIdRef.current = agentSessionId;
  }, [agentSessionId]);

  // Shared refs for Source 1 / Source 3 coordination:
  //   - eventsAtomRef: latest eventsAtom snapshot for use inside event listeners
  //   - streamingReceivedIdsRef: event IDs for which Source 1 received live chunks
  //   - historyWrittenIdsRef: event IDs already written by Source 3 (history fill)
  const eventsAtomRef = useRef<SessionEvent[]>([]);
  const streamingReceivedIdsRef = useRef<Set<string>>(new Set());
  const historyWrittenIdsRef = useRef<Set<string>>(new Set());

  // Fit terminal to container
  const fitTerminal = useCallback((retryCount = 0) => {
    if (fitAddonRef.current && terminalRef.current && containerRef.current) {
      try {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          if (retryCount < 5) {
            setTimeout(
              () => fitTerminal(retryCount + 1),
              100 * Math.pow(2, retryCount)
            );
          }
          return;
        }
        fitAddonRef.current.fit();
        terminalRef.current.refresh(0, terminalRef.current.rows - 1);
      } catch (error) {
        console.warn("[TerminalReadOnly] Fit error:", error);
      }
    }
  }, []);

  // Initialize terminal (no PTY)
  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return;

    const theme = getXTermTheme(terminalTheme);

    const terminal = new Terminal({
      theme,
      fontSize: terminalFontSize,
      fontFamily: codeFontFamily,
      fontWeight: "400",
      fontWeightBold: "700",
      letterSpacing: terminalLetterSpacing,
      lineHeight: 1.0,
      cursorBlink: false,
      cursorStyle: "underline",
      cursorInactiveStyle: "none",
      scrollback: 5000,
      drawBoldTextInBrightColors: false,
      minimumContrastRatio: 1,
      customGlyphs: true,
      rescaleOverlappingGlyphs: true,
      allowProposedApi: true,
      disableStdin: true,
    });

    // Addons (no serialize — no buffer persistence needed)
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    _searchAddonRef.current = searchAddon;

    // WebGL addon
    const loadWebGL = () => {
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          console.warn(
            "[TerminalReadOnly] WebGL context lost, falling back to canvas"
          );
          webglAddon.dispose();
          webglAddonRef.current = null;
        });
        terminal.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
      } catch (error) {
        console.warn("[TerminalReadOnly] WebGL addon failed:", error);
      }
    };

    const checkAndInit = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        loadWebGL();
        fitTerminal();
        setIsReady(true);
        setTimeout(fitTerminal, 150);
      } else {
        initTimeoutRef.current = setTimeout(checkAndInit, 50);
      }
    };

    requestAnimationFrame(() => {
      checkAndInit();
    });

    return () => {
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
      if (webglAddonRef.current) {
        webglAddonRef.current.dispose();
        webglAddonRef.current = null;
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      _searchAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitTerminal]);

  // Source 1: Subscribe to `agent-exec-output` CustomEvent (subprocess streaming).
  // When chunks arrive, mark the currently-running shell event for this session
  // as "streaming received" so Source 3 skips writing history for it later.
  useEffect(() => {
    function handleExecOutput(evt: Event) {
      const detail = (
        evt as CustomEvent<{
          sessionId: string;
          chunk: string;
          stream: string;
        }>
      ).detail;
      if (!detail || !terminalRef.current) return;

      // Only accept events for our agent session
      if (detail.sessionId !== agentSessionIdRef.current) return;

      if (detail.stream === "system") {
        terminalRef.current.write(formatSystemChunk(detail.chunk));
      } else if (detail.stream === "stderr") {
        // stderr in red
        terminalRef.current.write(`${ANSI_RED}${detail.chunk}${ANSI_RESET}`);
      } else {
        // stdout as-is (already includes newlines from line-by-line reading)
        terminalRef.current.write(detail.chunk);
      }

      // Mark the currently-running shell event as live-streamed so Source 3
      // doesn't overwrite with stale history when the event completes.
      const currentEvents = eventsAtomRef.current;
      if (currentEvents) {
        for (const event of currentEvents) {
          if (event.sessionId !== agentSessionIdRef.current) continue;
          if (!isShellTool(event.functionName)) continue;
          if (event.isDelta) continue;
          if (event.displayStatus === "running") {
            streamingReceivedIdsRef.current.add(event.id);
            break;
          }
        }
      }
    }

    window.addEventListener("agent-exec-output", handleExecOutput);
    return () => {
      window.removeEventListener("agent-exec-output", handleExecOutput);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Source 2: Subscribe to `pty-output-osagent-pty-main` Tauri event (PTY mirror)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

    listenTauri<PtyOutputPayload>(`pty-output-${PTY_SESSION_ID}`, (event) => {
      if (cancelled || !terminalRef.current) return;

      const { bytes, data } = event.payload;
      if (bytes && bytes.length > 0) {
        const decoded = utf8Decoder.decode(new Uint8Array(bytes), {
          stream: true,
        });
        if (decoded) {
          terminalRef.current.write(decoded);
        }
      } else if (data) {
        terminalRef.current.write(data);
      }
    }).then((unlistenFn) => {
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    });

    return () => {
      cancelled = true;
      const trailingOutput = utf8Decoder.decode();
      if (trailingOutput && terminalRef.current) {
        terminalRef.current.write(trailingOutput);
      }
      if (unlisten) unlisten();
    };
  }, []);

  // Source 3: Subscribe to eventsAtom for shell events.
  //
  // Purpose: fill in history for events that completed *before* this terminal
  // mounted (or before Source 1/2 had a chance to receive the streaming chunks).
  //
  // Two-phase write per event:
  //   Phase A (running):  skipped — Source 1 will write the header via the
  //                       first `"system"` stream chunk from Rust.
  //   Phase B (done):     write the full output + exit-code footer ONLY when
  //                       Source 1 never wrote anything for this event (streaming
  //                       chunks already live-written the content).
  //
  // If Source 1 did handle the event (streamed chunks in real-time), we skip
  // both phases to avoid duplicate output in the terminal.
  const events = useAtomValue(eventsAtom);
  // Sync the latest events snapshot into the ref so Source 1's event
  // listener (registered with [] deps) can read it without going stale.
  eventsAtomRef.current = events;

  useEffect(() => {
    if (!terminalRef.current || !isReady) return;

    const terminal = terminalRef.current;
    const streamingReceived = streamingReceivedIdsRef.current;
    const historyWritten = historyWrittenIdsRef.current;

    for (const event of events) {
      if (event.sessionId !== agentSessionIdRef.current) continue;
      if (!isShellTool(event.functionName)) continue;
      if (event.isDelta) continue;
      if (historyWritten.has(event.id)) continue;

      const isRunning = event.displayStatus === "running";
      const isDone = !isRunning;

      if (isRunning) {
        // Running: Source 1 (subprocess) or Source 2 (PTY) may be streaming
        // live. Do NOT pre-mark streamingReceived here — Source 1 only adds
        // the event ID after it has actually written a chunk to the terminal.
        // If the terminal wasn't mounted yet when Source 1 received chunks,
        // streamingReceived stays empty and Source 3 will correctly fill the
        // history once the command completes and the terminal is ready.
        continue;
      }

      // Completed event: check if Source 1 live-streamed this command.
      // If streaming was received, Source 1 already wrote header + output.
      // We only need to write history for events that Source 1 missed.
      if (isDone && !streamingReceived.has(event.id)) {
        const { command, output, exitCode } = extractShellFromEvent(event);

        if (command) {
          terminal.write(formatSystemChunk(`$ ${command}`));
        }

        if (output) {
          const formatted = output.replace(/\n/g, "\r\n");
          terminal.write(formatted);
          if (!formatted.endsWith("\r\n")) {
            terminal.write("\r\n");
          }
        }

        if (exitCode !== undefined) {
          terminal.write(formatSystemChunk(`[exit code: ${exitCode}]`));
        }

        historyWritten.add(event.id);
      }
    }

    // Evict old IDs to prevent unbounded growth (FIFO, keep last 200)
    for (const setRef of [streamingReceived, historyWritten]) {
      if (setRef.size > MAX_WRITTEN_IDS) {
        const idsArray = [...setRef];
        setRef.clear();
        for (const id of idsArray.slice(-200)) {
          setRef.add(id);
        }
      }
    }
  }, [events, isReady]);

  // Handle window/panel resize
  useEffect(() => {
    const handleResize = () => {
      setTimeout(fitTerminal, 50);
      setTimeout(fitTerminal, 150);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [fitTerminal]);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(fitTerminal, 50);
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [fitTerminal]);

  // Theme changes — patch live, drop the WebGL atlas (cached glyph bitmaps
  // were drawn with the old foreground colour), then refresh.
  useEffect(() => {
    if (terminalRef.current && isReady) {
      const terminal = terminalRef.current;
      terminal.options.theme = getXTermTheme(terminalTheme);
      terminal.clearTextureAtlas();
      terminal.refresh(0, terminal.rows - 1);
      requestAnimationFrame(() => fitTerminal());
    }
  }, [terminalTheme, isDarkTheme, isReady, fitTerminal]);

  // Font size changes
  useEffect(() => {
    if (terminalRef.current && isReady) {
      terminalRef.current.options.fontSize = terminalFontSize;
      setTimeout(fitTerminal, 50);
    }
  }, [terminalFontSize, isReady, fitTerminal]);

  // Letter spacing changes
  useEffect(() => {
    if (terminalRef.current && isReady) {
      terminalRef.current.options.letterSpacing = terminalLetterSpacing;
      setTimeout(fitTerminal, 50);
    }
  }, [terminalLetterSpacing, isReady, fitTerminal]);

  // Font family changes
  useEffect(() => {
    if (terminalRef.current && isReady) {
      terminalRef.current.options.fontFamily = codeFontFamily;
      setTimeout(fitTerminal, 50);
    }
  }, [codeFontFamily, isReady, fitTerminal]);

  return (
    <div className="xterm-terminal-view">
      <div ref={containerRef} className="xterm-terminal-container" />
    </div>
  );
};

export default TerminalReadOnly;
