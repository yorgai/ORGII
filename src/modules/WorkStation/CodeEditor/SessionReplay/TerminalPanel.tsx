/**
 * TerminalPanel Component
 *
 * Bottom panel with:
 * - Left: Terminal output (header + command output)
 * - Right: Shell history sidebar (filterable list of commands)
 * Resizable and collapsible.
 */
import {
  TERMINAL_SESSION_LIST_OUTER_CLASS,
  TERMINAL_SESSION_LIST_OUTER_RESIZING_LINE_CLASS,
  TERMINAL_SESSION_LIST_RESIZE_HANDLE_LINE_CLASS,
} from "@/src/engines/TerminalCore/exports";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { TerminalCommand } from "@src/components/TerminalDisplay";
import "@src/components/TerminalDisplay/index.scss";
import { TreeRowBase } from "@src/components/TreeRow";
import { AGENT_DOT_TOKENS } from "@src/engines/Simulator/config";
import { useResizeHandle } from "@src/hooks/ui/useResizeHandle";
import {
  TERMINAL_OUTPUT_MAX_LENGTH,
  processTerminalOutput,
} from "@src/modules/WorkStation/CodeEditor/util/terminalOutput";
import { WorkStationTabPill } from "@src/modules/WorkStation/shared";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  HorizontalResizeHandle,
  VerticalResizeHandle,
} from "@src/scaffold/Resize";

import { SimulatorShellCssOutput } from "./ShellCssOutput";
import { getShellStatusBadge } from "./ShellSidebar";
import type { ShellOperationEntry } from "./types";

// ============================================
// Types
// ============================================

interface TerminalPanelProps {
  selectedShellOperation: ShellOperationEntry | null;
  isCollapsed: boolean;
  onToggle: () => void;
  height: number;
  onHeightChange: (height: number) => void;
  minHeight?: number;
  maxHeight?: number;
  customControls?: React.ReactNode;
  /** Shell operations for the right-side history sidebar */
  shellOperations: ShellOperationEntry[];
  /** Currently selected shell event ID */
  selectedShellEventId: string | null;
  /** Callback when a shell operation is selected */
  onSelectShellOperation: (eventId: string) => void;
  /** Current event ID (for agent indicator) */
  currentEventId: string;
}

// ============================================
// Component
// ============================================

const DEFAULT_SHELL_SIDEBAR_WIDTH = 200;
const MIN_SHELL_SIDEBAR_WIDTH = 120;
const MAX_SHELL_SIDEBAR_WIDTH = 300;

export const TerminalPanel: React.FC<TerminalPanelProps> = memo(
  ({
    selectedShellOperation,
    isCollapsed,
    onToggle,
    height,
    onHeightChange,
    minHeight = 160,
    maxHeight = 400,
    customControls,
    shellOperations,
    selectedShellEventId,
    onSelectShellOperation,
    currentEventId,
  }) => {
    const { t } = useTranslation("sessions");
    const [_isResizing, setIsResizing] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const terminalTabs = useMemo(
      () => [
        {
          key: "terminal" as const,
          label: t("simulator.replay.ide.terminal.tabTerminal"),
        },
      ],
      [t]
    );

    const [shellSidebarWidth, setShellSidebarWidth] = useState(
      DEFAULT_SHELL_SIDEBAR_WIDTH
    );
    const {
      handleMouseDown: handleSidebarMouseDown,
      isResizing: isShellSidebarWidthResizing,
    } = useResizeHandle(shellSidebarWidth, setShellSidebarWidth, {
      direction: "horizontal",
      minSize: MIN_SHELL_SIDEBAR_WIDTH,
      maxSize: MAX_SHELL_SIDEBAR_WIDTH,
      isReversed: true,
    });

    // Stable key: only changes when the command list actually changes,
    // not on every currentEventId navigation.
    const shellItemsKey = useMemo(
      () => shellOperations.map((op) => op.eventId).join(","),
      [shellOperations]
    );

    const shellItems = useMemo(
      () =>
        shellOperations.map((op) => {
          const badge = getShellStatusBadge(op);
          return {
            id: op.eventId,
            name: op.commandKeywords || op.shortCommand,
            statusBadge: badge?.text,
            statusBadgeClass: badge?.className,
          };
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by shellItemsKey
      [shellItemsKey]
    );

    // Scroll selected shell item into view when selection changes
    const shellListRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!selectedShellEventId || !shellListRef.current) return;
      const el = shellListRef.current.querySelector<HTMLElement>(
        `[data-shell-event-id="${selectedShellEventId}"]`
      );
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, [selectedShellEventId]);

    // Height resize handling with RAF throttling
    // PERFORMANCE: Uses requestAnimationFrame to prevent layout thrashing
    // during rapid mousemove events
    const rafIdRef = useRef<number | null>(null);

    const handleMouseDown = useCallback(
      (event: React.MouseEvent) => {
        event.preventDefault();

        let latestClientY = event.clientY;
        let hasDragged = false;

        // Cache the container rect at drag-start instead of reading
        // parentElement on every RAF frame — resilient to DOM depth changes.
        const containerRect =
          panelRef.current?.parentElement?.getBoundingClientRect() ?? null;

        const applyResize = () => {
          rafIdRef.current = null;
          if (!containerRect) return;

          const newHeight = containerRect.bottom - latestClientY;
          const clampedHeight = Math.min(
            maxHeight,
            Math.max(minHeight, newHeight)
          );
          onHeightChange(clampedHeight);
        };

        const handleMouseMove = (moveEvent: MouseEvent) => {
          if (!hasDragged) {
            hasDragged = true;
            setIsResizing(true);
            document.body.style.cursor = "row-resize";
            document.body.style.userSelect = "none";
          }

          latestClientY = moveEvent.clientY;

          // RAF throttle: only schedule if no pending frame
          if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(applyResize);
          }
        };

        const handleMouseUp = () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);

          if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
          }

          setIsResizing(false);
          if (hasDragged) {
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
          }
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      },
      [minHeight, maxHeight, onHeightChange]
    );

    // Process and truncate output using shared utility
    const truncatedOutput = useMemo(() => {
      if (!selectedShellOperation) return "";
      const suffix = t("simulator.replay.ide.codePanel.truncatedSuffix");
      return processTerminalOutput(
        selectedShellOperation.output,
        TERMINAL_OUTPUT_MAX_LENGTH,
        suffix
      );
    }, [selectedShellOperation, t]);

    const useCssShellSurface =
      !!selectedShellOperation && !selectedShellOperation.customOutputComponent;

    // Collapsed state - 32px bar with chevron up
    if (isCollapsed) {
      return (
        <div
          className="flex h-8 shrink-0 cursor-pointer items-center justify-center border-t border-border-2 bg-bg-1"
          onClick={onToggle}
        >
          <ChevronUp size={14} className="text-text-3 hover:text-text-1" />
        </div>
      );
    }

    return (
      <div
        ref={panelRef}
        className="group/panel relative flex shrink-0 flex-col bg-bg-1"
        style={{ height: `${height}px` }}
      >
        {/* Resize handle */}
        <HorizontalResizeHandle onMouseDown={handleMouseDown} />

        {/* Header - full width, matching WorkStation BottomPanelHeader layout */}
        <div className="flex h-10 shrink-0 items-center justify-between pl-2 pr-3">
          <div className="flex min-w-0 flex-1 items-center">
            <WorkStationTabPill
              activeTab="terminal"
              tabs={terminalTabs}
              onChange={() => {}}
              variant="pill"
              color="fill"
              fillWidth={false}
            />
          </div>

          <div className="flex items-center gap-1.5">
            {customControls}
            <button
              onClick={onToggle}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>

        {/* Content area: terminal output (left) + shell history (right) */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: Terminal output */}
          <div
            className={`min-h-0 min-w-0 flex-1 pb-[100px] ${
              useCssShellSurface
                ? "flex flex-col overflow-hidden"
                : "overflow-auto"
            }`}
          >
            {selectedShellOperation ? (
              <>
                {useCssShellSurface ? (
                  <SimulatorShellCssOutput
                    command={selectedShellOperation.command}
                    output={truncatedOutput}
                    exitCode={selectedShellOperation.exitCode}
                    isLoading={selectedShellOperation.isLoading}
                    streamOutput={selectedShellOperation.streamOutput}
                  />
                ) : (
                  <>
                    <TerminalCommand
                      command={selectedShellOperation.command}
                      prefix="$"
                      fontSize={12}
                      singleLineEllipsis
                    />
                    {selectedShellOperation.customOutputComponent ? (
                      <div>{selectedShellOperation.customOutputComponent}</div>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <div className="flex min-h-0 min-h-full w-full flex-1 flex-col">
                <Placeholder
                  variant="empty"
                  placement="detail-panel"
                  fillParentHeight
                  title={t("simulator.replay.ide.terminal.emptySelectCommand")}
                />
              </div>
            )}
          </div>

          {/* Right: Shell history sidebar (matches WorkStation terminal sidebar) */}
          {shellItems.length > 0 && (
            <div
              className={`${TERMINAL_SESSION_LIST_OUTER_CLASS}${
                isShellSidebarWidthResizing
                  ? ` ${TERMINAL_SESSION_LIST_OUTER_RESIZING_LINE_CLASS}`
                  : ""
              }`}
            >
              <VerticalResizeHandle
                onMouseDown={handleSidebarMouseDown}
                variant="transparent"
                isResizing={isShellSidebarWidthResizing}
                className={TERMINAL_SESSION_LIST_RESIZE_HANDLE_LINE_CLASS}
              />
              <div
                className="relative shrink-0"
                style={{ width: `${shellSidebarWidth}px` }}
              >
                <div
                  ref={shellListRef}
                  className="flex h-full flex-col overflow-auto py-1"
                >
                  {shellItems.map((item) => {
                    const isItemSelected = selectedShellEventId === item.id;
                    const isAgentSelected = item.id === currentEventId;
                    return (
                      <div key={item.id} data-shell-event-id={item.id}>
                        <TreeRowBase
                          node={{
                            id: item.id,
                            name: item.name,
                            path: item.id,
                            type: "file",
                            icon: (
                              <Terminal
                                size={16}
                                className={
                                  isItemSelected ? "text-text-1" : "text-text-3"
                                }
                              />
                            ),
                          }}
                          depth={0}
                          isSelected={isItemSelected}
                          onClick={() => onSelectShellOperation(item.id)}
                          rounded={false}
                        >
                          {item.statusBadge && (
                            <span
                              className={`flex-shrink-0 text-[11px] ${item.statusBadgeClass}`}
                            >
                              {item.statusBadge}
                            </span>
                          )}
                          {isAgentSelected && (
                            <div className={AGENT_DOT_TOKENS.container}>
                              <div className={AGENT_DOT_TOKENS.dot} />
                            </div>
                          )}
                        </TreeRowBase>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

TerminalPanel.displayName = "TerminalPanel";

export default TerminalPanel;
