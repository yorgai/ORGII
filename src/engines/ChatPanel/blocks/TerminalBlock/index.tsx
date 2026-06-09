/**
 * TerminalBlock Component
 *
 * Same outer shell as ChatCodeBlock (edit): one `bg-fill-2` rounded card; header and
 * body share that background. Command + output sit below the header without a nested
 * second fill panel.
 */
import { Square } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import ExpandOverlay from "@src/components/ExpandOverlay";
import { TerminalCommand } from "@src/components/TerminalDisplay";
import { getToolIcon } from "@src/config/toolIcons";
import type { PayloadRef } from "@src/engines/SessionCore/core/types";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import {
  BlockOutput,
  EVENT_BLOCK_FADE_FROM,
  EVENT_LOADING_SHIMMER_TEXT_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import { formatCommandForDisplay, getCommandSymbolList } from "./commandParser";

const TERMINAL_COMMAND_PREVIEW_MAX_HEIGHT = 79;
const TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT = 72;
const TERMINAL_EXPANDED_MAX_HEIGHT = "min(320px, 30vh)";
const TERMINAL_COMMAND_EXPAND_LINE_THRESHOLD = 3;

export interface TerminalBlockProps {
  command?: string;
  output?: string;
  exitCode?: number;
  executionTime?: number;
  isError?: boolean;
  defaultCollapsed?: boolean;
  title?: string;
  /** Optional event ID for simulator replay */
  eventId?: string;
  sessionId?: string;
  payloadRef?: PayloadRef;
  /** When true, shows animated icon and streaming-friendly layout */
  isLoading?: boolean;
  /** Live streaming output (shown during loading before final output) */
  streamOutput?: string;
  /** Process ID shown for backgrounded processes and used for Stop while actively running. */
  pid?: number;
  /**
   * Process status: running, background, exited, killed.
   * NOTE: `"running"` alone does NOT show the Stop button; `isLoading` must
   * also be true. Backgrounded processes show status/PID only.
   */
  processStatus?: "running" | "background" | "exited" | "killed";
  /** Callback when user clicks Stop */
  onStop?: (pid: number) => void;
}

const TerminalBlock: React.FC<TerminalBlockProps> = memo(
  ({
    command,
    output,
    exitCode,
    executionTime: _executionTime,
    isError = false,
    defaultCollapsed,
    title,
    eventId,
    sessionId,
    payloadRef,
    isLoading = false,
    streamOutput,
    pid,
    processStatus,
    onStop,
  }) => {
    const isErrorExit = exitCode !== undefined && exitCode !== 0;
    const isBackground = processStatus === "background";
    const isStillRunning = isLoading || isBackground;
    // Visibility policy:
    // - Caller-provided defaults always win.
    // - Errors → expanded (need to see what failed).
    // - Still running OR backgrounded → expanded so progress remains visible.
    // - Done & no error → collapse to a chip by default.
    const effectiveDefaultCollapsed =
      defaultCollapsed ?? (isErrorExit ? false : isStillRunning ? false : true);

    const {
      isCollapsed,
      isHeaderHovered,
      handleHeaderClick,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate,
      setIsCollapsed,
    } = useBlockHeader({
      defaultCollapsed: effectiveDefaultCollapsed,
      eventId,
      collapseAllValue: true,
      preserveDefaultOnExpand: true,
    });

    const wasStillRunningRef = useRef(isStillRunning);
    useEffect(() => {
      if (wasStillRunningRef.current && !isStillRunning && !isErrorExit) {
        setIsCollapsed(true);
      }
      wasStillRunningRef.current = isStillRunning;
    }, [isStillRunning, isErrorExit, setIsCollapsed]);

    const { t } = useTranslation("sessions");
    const { t: tCommon } = useTranslation();
    const displayOutput = output || streamOutput;
    const displayTitle =
      title?.trim() ||
      (isLoading ? t("tools.runCommandRunning") : t("tools.runCommandDone"));
    const commandSymbols = useMemo(
      () => getCommandSymbolList(command),
      [command]
    );
    const hasOutput = Boolean(displayOutput && displayOutput.trim().length > 0);

    const { isDark } = useCurrentTheme();
    const shikiTheme = isDark ? "one-dark-pro" : "github-light";
    const formattedCommand = useMemo(
      () => (command ? formatCommandForDisplay(command) : ""),
      [command]
    );
    // Always clamp the command region to TERMINAL_COMMAND_PREVIEW_MAX_HEIGHT
    // and measure the viewport's own scrollHeight vs clientHeight to decide
    // whether to surface the fade + Show more pill. Doing the measurement on
    // the always-clamped viewport (instead of a separate content wrapper
    // whose scrollHeight depends on async Shiki / ResizeObserver timing)
    // means `commandOverflows` is accurate the moment layout settles —
    // whether or not Shiki has finished highlighting, and even after
    // collapse/expand remounts the inner DOM.
    const commandViewportRef = useRef<HTMLDivElement | null>(null);
    const commandContentRef = useRef<HTMLDivElement | null>(null);
    const [commandOverflows, setCommandOverflows] = useState(false);
    const [isCommandExpanded, setIsCommandExpanded] = useState(false);

    useLayoutEffect(() => {
      const viewportElement = commandViewportRef.current;
      const contentElement = commandContentRef.current;
      if (!viewportElement || !contentElement) return;
      const measure = () => {
        const computedStyle = window.getComputedStyle(contentElement);
        const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20;
        const fontSize = Number.parseFloat(computedStyle.fontSize) || 13;
        const contentHeight = contentElement.scrollHeight;
        const visibleLineCount = Math.ceil(contentHeight / lineHeight);
        const averageCharacterWidth = fontSize * 0.62;
        const estimatedCharactersPerLine = Math.max(
          1,
          Math.floor(viewportElement.clientWidth / averageCharacterWidth)
        );
        const estimatedWrappedLineCount = formattedCommand
          .split("\n")
          .reduce(
            (total, line) =>
              total +
              Math.max(1, Math.ceil(line.length / estimatedCharactersPerLine)),
            0
          );
        setCommandOverflows(
          contentHeight > viewportElement.clientHeight + 1 ||
            visibleLineCount > TERMINAL_COMMAND_EXPAND_LINE_THRESHOLD ||
            estimatedWrappedLineCount > TERMINAL_COMMAND_EXPAND_LINE_THRESHOLD
        );
      };
      measure();
      const frame = window.requestAnimationFrame(measure);
      const observer = new ResizeObserver(measure);
      observer.observe(viewportElement);
      observer.observe(contentElement);
      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }, [formattedCommand, isCommandExpanded]);

    // Stop button state — reset when process finishes.
    //
    // Gate on `isLoading` so backgrounded shell cards keep their status/PID
    // visible without showing an inline stop/end control.
    const [isStopping, setIsStopping] = useState(false);
    useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!isStillRunning) setIsStopping(false);
    }, [isStillRunning]);
    const effectiveIsStopping = isStopping && isStillRunning;
    const canStop = pid !== undefined && isLoading && !isBackground;

    const handleStop = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation();
        if (pid && onStop && !effectiveIsStopping) {
          setIsStopping(true);
          onStop(pid);
        }
      },
      [pid, onStop, effectiveIsStopping]
    );

    const statusLabel = useMemo(() => {
      if (processStatus === "killed") {
        return (
          <span className="shrink-0 text-danger-6">
            {t("tools.shellStatus.killed")}
          </span>
        );
      }
      if (processStatus === "background") {
        const label = pid
          ? t("tools.shellStatus.backgroundWithPid", { pid })
          : t("tools.shellStatus.background");
        return <span className="shrink-0 text-text-3">{label}</span>;
      }
      return null;
    }, [processStatus, pid, t]);

    if (!command && !output && !streamOutput) return null;

    const hasContent = Boolean(command || displayOutput);

    const headerRight =
      statusLabel || canStop ? (
        <div className="flex items-center gap-2 pl-2">
          {statusLabel}
          {canStop && (
            <button
              type="button"
              className="flex h-5 w-0 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border-none bg-text-2 text-white transition-colors hover:bg-text-1 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 group-hover/chat-block-header:w-5"
              onClick={handleStop}
              disabled={effectiveIsStopping}
              title={tCommon("common:actions.stop")}
              aria-label={tCommon("common:actions.stop")}
            >
              {effectiveIsStopping ? (
                <div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Square size={10} fill="currentColor" strokeWidth={0} />
              )}
            </button>
          )}
        </div>
      ) : undefined;

    return (
      <div className={getEventBlockContainerClasses(true)}>
        <EventBlockHeader
          isCollapsed={isCollapsed}
          withHover
          className={
            isCollapsed
              ? "border-b border-solid border-transparent"
              : "border-b border-solid border-border-1"
          }
          onClick={handleLocate}
          onNavigate={handleLocate}
          onMouseEnter={handleHeaderMouseEnter}
          onMouseLeave={handleHeaderMouseLeave}
          rightContent={headerRight}
        >
          <EventBlockHeaderIcon
            icon={getToolIcon("run_shell", {
              size: 14,
              className: "text-text-2",
            })}
            isCollapsed={isCollapsed}
            isHeaderHovered={isHeaderHovered}
            onToggle={handleHeaderClick}
            hasContent={hasContent}
            revealChevronOnIconHoverOnly={Boolean(eventId)}
            isLoading={isStillRunning}
            isFailed={isError}
          />
          <span
            className={`min-w-0 shrink truncate ${isStillRunning ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}` : isError ? "font-medium text-text-3" : "font-medium text-text-1"}`}
            title={displayTitle}
          >
            {displayTitle}
          </span>
          {commandSymbols.length > 0 ? (
            <span
              className={`shrink-0 ${isStillRunning ? `font-bold ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}` : "text-text-1"}`}
              title={commandSymbols.join(", ")}
            >
              {commandSymbols.length <= 2
                ? commandSymbols.join(", ")
                : `${commandSymbols.slice(0, 2).join(", ")}, +${commandSymbols.length - 2}`}
            </span>
          ) : null}
          {!isStillRunning && exitCode !== undefined && exitCode !== 0 && (
            <span className="shrink-0 text-danger-6">exit {exitCode}</span>
          )}
        </EventBlockHeader>

        {!isCollapsed && (
          <div className="min-w-0">
            {command && (
              <div
                ref={commandViewportRef}
                className="group/expand relative scrollbar-hide"
                style={
                  isCommandExpanded
                    ? {
                        maxHeight: TERMINAL_EXPANDED_MAX_HEIGHT,
                        overflowY: "auto",
                        overflowX: "auto",
                      }
                    : {
                        maxHeight: TERMINAL_COMMAND_PREVIEW_MAX_HEIGHT,
                        overflowY: "hidden",
                        overflowX: "auto",
                      }
                }
              >
                <div ref={commandContentRef}>
                  <TerminalCommand
                    command={formattedCommand}
                    prefix="$"
                    className="terminal-command--chat"
                    shikiTheme={shikiTheme}
                    style={{
                      fontSize: "var(--chat-code-font-size, 13px)",
                    }}
                  />
                </div>
                {(commandOverflows || isCommandExpanded) && (
                  <ExpandOverlay
                    isExpanded={isCommandExpanded}
                    onToggle={(event) => {
                      event.stopPropagation();
                      if (isCommandExpanded) {
                        commandViewportRef.current?.scrollTo({ top: 0 });
                      }
                      setIsCommandExpanded((prev) => !prev);
                    }}
                    fadeFrom={EVENT_BLOCK_FADE_FROM}
                  />
                )}
              </div>
            )}

            {command && hasOutput && (
              <div className="px-2">
                <div className="border-t border-solid border-border-2" />
              </div>
            )}

            {hasOutput && (
              <BlockOutput
                output={displayOutput!}
                isError={!isLoading && exitCode !== undefined && exitCode !== 0}
                status={
                  isLoading || exitCode === undefined
                    ? "default"
                    : exitCode === 0
                      ? "success"
                      : "error"
                }
                highlightLang="log"
                shikiTheme={shikiTheme}
                withBorder={false}
                sessionId={sessionId}
                eventId={eventId}
                payloadRef={payloadRef}
                collapsedMaxHeight={TERMINAL_OUTPUT_PREVIEW_MAX_HEIGHT}
                defaultScrollToBottom
                expandLineThreshold={TERMINAL_COMMAND_EXPAND_LINE_THRESHOLD}
              />
            )}
          </div>
        )}
      </div>
    );
  }
);

TerminalBlock.displayName = "TerminalBlock";

export default TerminalBlock;
