/**
 * IndependentGridCell
 *
 * Grid cell with its own replay state via useCellReplayState.
 * Renders events using SubagentEventPane — which routes to the same pane
 * components as the main simulator (CodePanel for file/shell/explore,
 * CompactEventView for messages, etc.) via pure deriveState functions.
 * No global session atom dependencies. No SimulatorTitleBar — the cell
 * uses a fixed top header (task + dock app on the right) and a bottom replay
 * bar that appears only while the pointer is over this cell’s pane/footer
 * region (not the header). Visibility uses local state per cell — not Tailwind
 * `group-hover`, so ancestor `group` classes cannot keep the bar stuck open.
 *
 * The cell follows the main replay cursor (video-editor clip model) by
 * default, unless the user manually interacts with its controls.
 */
import { useAtomValue } from "jotai";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
} from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Slider from "@src/components/Slider";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import { REPLAY_CONFIG } from "@src/config/workspace/replayConfig";
import { focusedSubagentCellAtom } from "@src/store/ui/simulatorAtom";

import { useCellReplayState } from "../../hooks/useCellReplayState";
import type { GridCellProps } from "../../types/gridTypes";
import { mergeSessionEventsToolResultsByCallId } from "../../utils/mergeSessionEventsToolResultsByCallId";
import "./IndependentGridCell.scss";
import { SubagentChatPane } from "./SubagentChatPane";
import { SubagentPinnedPreviewPopover } from "./SubagentPinnedPreviewPopover";

const IndependentGridCellComponent: React.FC<GridCellProps> = ({
  index,
  color: _color,
  title,
  subtitle,
  events,
  sessionType: _sessionType,
  threadId,
  externalCursorMs = null,
  isHighlighted: _isHighlighted = false,
  isExpanded = false,
  onExpand,
}) => {
  const { t } = useTranslation("sessions");
  const focusedCellId = useAtomValue(focusedSubagentCellAtom);
  const isFocused = Boolean(threadId && focusedCellId === threadId);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);

  // Merge tool call/result pairs once per events-array change, not per cursor
  // tick. SubagentEventPane now expects pre-merged events.
  const mergedEvents = useMemo(
    () => mergeSessionEventsToolResultsByCallId(events),
    [events]
  );

  const { state, controls } = useCellReplayState({
    events: mergedEvents,
    startAtEnd: true,
    cellId: threadId || `cell-${index}`,
    externalCursorMs: externalCursorMs ?? null,
  });

  /** Same Slider + REPLAY_CONFIG mapping as `MusicPlayerReplayBar`. */
  const eventCount = state.totalEvents;
  const currentIndex = state.currentIndex;
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [dragSliderValue, setDragSliderValue] = useState(0);
  const [isPointerInReplayRegion, setIsPointerInReplayRegion] = useState(false);
  const dragSliderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showReplayFooter = isPointerInReplayRegion || isDraggingSlider;

  const sliderValue = useMemo(() => {
    if (eventCount <= 1) return 0;
    const safeIndex = Math.max(0, currentIndex);
    return (safeIndex / (eventCount - 1)) * REPLAY_CONFIG.MAX_VALUE;
  }, [currentIndex, eventCount]);

  const displaySliderValue = isDraggingSlider ? dragSliderValue : sliderValue;

  const sliderValueToIndex = useCallback(
    (value: number): number => {
      if (eventCount <= 1) return 0;
      return Math.round((value / REPLAY_CONFIG.MAX_VALUE) * (eventCount - 1));
    },
    [eventCount]
  );

  const handleSliderChange = useCallback(
    (value: number | number[]) => {
      const numVal = Array.isArray(value) ? value[0] : value;
      setIsDraggingSlider(true);
      setDragSliderValue(numVal);

      if (dragSliderTimerRef.current) {
        clearTimeout(dragSliderTimerRef.current);
      }

      dragSliderTimerRef.current = setTimeout(() => {
        controls.goToIndex(sliderValueToIndex(numVal));
      }, 16);
    },
    [controls, sliderValueToIndex]
  );

  const handleSliderAfterChange = useCallback(
    (value: number | number[]) => {
      const numVal = Array.isArray(value) ? value[0] : value;

      if (dragSliderTimerRef.current) {
        clearTimeout(dragSliderTimerRef.current);
        dragSliderTimerRef.current = null;
      }

      controls.goToIndex(sliderValueToIndex(numVal));
      setIsDraggingSlider(false);
    },
    [controls, sliderValueToIndex]
  );

  useEffect(() => {
    return () => {
      if (dragSliderTimerRef.current) {
        clearTimeout(dragSliderTimerRef.current);
      }
    };
  }, []);

  const replaySliderDisabled = eventCount === 0;

  /**
   * Cursor in epoch ms for the inner ChatHistory pane.
   *
   * - `null` ⇒ live tail; ChatHistory shows all events as they stream in.
   * - number ⇒ replay scrub; ChatHistory will only render events with
   *   `createdAt <= cursorMs`.
   *
   * We treat "cursor at last index AND not actively scrubbing" as live
   * tail so the streaming UX is identical to a top-level ChatHistory.
   */
  const cursorMsForPane = useMemo<number | null>(() => {
    if (eventCount === 0) return null;
    const atTail = currentIndex >= eventCount - 1;
    if (atTail && !isDraggingSlider) return null;
    const ev = state.currentEvent;
    if (!ev?.createdAt) return null;
    const t = Date.parse(ev.createdAt);
    return Number.isFinite(t) ? t : null;
  }, [currentIndex, eventCount, isDraggingSlider, state.currentEvent]);

  return (
    <div
      className={`relative h-full w-full overflow-hidden transition-all duration-300 ${isFocused ? "z-10 ring-1 ring-inset ring-blue-500/50" : ""}`}
    >
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* ── Header ── */}
        <div
          className="group/header relative flex h-9 shrink-0 cursor-default items-center gap-1.5 bg-fill-2 pl-3 pr-1.5 transition-all duration-200"
          onMouseEnter={() => setIsHeaderHovered(true)}
          onMouseLeave={() => setIsHeaderHovered(false)}
        >
          {/* Task title (bold) · subtitle (regular) · current app icon. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className="shrink-0 truncate text-[13px] font-medium text-text-1 transition-colors duration-200"
              title={title}
            >
              {title}
            </span>
            {subtitle && (
              <>
                <span
                  aria-hidden
                  className="shrink-0 text-[11px] leading-none text-text-2"
                >
                  ·
                </span>
                <span
                  className="min-w-0 shrink truncate text-[13px] font-normal text-text-2"
                  title={subtitle}
                >
                  {subtitle}
                </span>
              </>
            )}
          </div>

          {/* Right-side action buttons — fade in on header hover.
              `will-change: opacity` keeps the compositor layer pinned across
              the transition so icons don't snap to integer pixels when the
              layer is destroyed at opacity:1. `invisible` + `pointer-events-none`
              ensure the buttons are truly inert while hidden. */}
          <div
            className={`flex items-center gap-1 transition-opacity duration-150 [will-change:opacity] ${
              isHeaderHovered
                ? "opacity-100"
                : "pointer-events-none invisible opacity-0"
            }`}
          >
            {/* Expand / collapse */}
            {onExpand && (
              <button
                type="button"
                onClick={onExpand}
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-2 ${SURFACE_TOKENS.iconButtonHover} hover:text-text-1`}
                title={
                  isExpanded
                    ? t("simulator.gridCell.collapse")
                    : t("simulator.gridCell.expand")
                }
              >
                {isExpanded ? (
                  <Minimize2 size={12} strokeWidth={2} />
                ) : (
                  <Maximize2 size={12} strokeWidth={2} />
                )}
              </button>
            )}
          </div>

          {/* Pinned-content hover popover. Renders the subagent's plan-todo
              summary (we suppress the in-history pinned bar so the cell's
              chat viewport stays clean). Anchored to the header so it
              floats above the chat surface on hover. */}
          {threadId && (
            <SubagentPinnedPreviewPopover
              sessionId={threadId}
              open={isHeaderHovered}
            />
          )}
        </div>

        {/* Event pane + replay footer */}
        <div
          className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
          onMouseEnter={() => setIsPointerInReplayRegion(true)}
          onMouseLeave={() => setIsPointerInReplayRegion(false)}
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            {threadId ? (
              <SubagentChatPane
                sessionId={threadId}
                cursorMs={cursorMsForPane}
              />
            ) : null}
          </div>

          {/* Footer — replay controls */}
          <div
            className={`flex shrink-0 items-center gap-1.5 overflow-hidden px-2 transition-[height,opacity] duration-200 ease-out ${
              showReplayFooter
                ? "pointer-events-auto h-6 opacity-100"
                : "pointer-events-none h-0 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={controls.togglePlay}
              aria-label={
                state.isPlaying
                  ? t("simulator.replay.pause", { defaultValue: "Pause" })
                  : t("simulator.replay.play", { defaultValue: "Play" })
              }
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-text-2 ${SURFACE_TOKENS.hover} hover:text-text-1`}
            >
              {state.isPlaying ? (
                <Pause size={11} strokeWidth={2} />
              ) : (
                <Play size={11} strokeWidth={2} />
              )}
            </button>
            {/* Prev / next event — moves the cell's replay cursor by one
                event in the merged stream. Disabled at the edges so the
                user gets explicit feedback that they're at the boundary. */}
            <button
              type="button"
              onClick={controls.prev}
              disabled={replaySliderDisabled || currentIndex <= 0}
              aria-label={t("simulator.replay.previous", {
                defaultValue: "Previous event",
              })}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-text-2 ${SURFACE_TOKENS.hover} hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-2`}
            >
              <ChevronLeft size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={controls.next}
              disabled={replaySliderDisabled || currentIndex >= eventCount - 1}
              aria-label={t("simulator.replay.next", {
                defaultValue: "Next event",
              })}
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-text-2 ${SURFACE_TOKENS.hover} hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-2`}
            >
              <ChevronRight size={12} strokeWidth={2} />
            </button>
            <div className="subagent-cell-replay-slider min-w-0 flex-1 px-1">
              <Slider
                value={displaySliderValue}
                max={REPLAY_CONFIG.MAX_VALUE}
                onChange={handleSliderChange}
                onAfterChange={handleSliderAfterChange}
                style={{ width: "100%", padding: 0 }}
                showTooltip={false}
                defaultValue={0}
                noPadding
                disabled={replaySliderDisabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const areGridCellPropsEqual = (
  prev: GridCellProps,
  next: GridCellProps
): boolean => {
  if (prev.index !== next.index) return false;
  if (prev.threadId !== next.threadId) return false;
  if (prev.title !== next.title) return false;
  if (prev.subtitle !== next.subtitle) return false;
  if (prev.sessionType !== next.sessionType) return false;
  if (prev.externalCursorMs !== next.externalCursorMs) return false;
  if (prev.isHighlighted !== next.isHighlighted) return false;
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.onExpand !== next.onExpand) return false;
  if (prev.events !== next.events) return false;
  return true;
};

const IndependentGridCell = memo<GridCellProps>(
  IndependentGridCellComponent,
  areGridCellPropsEqual
);
IndependentGridCell.displayName = "IndependentGridCell";

export { IndependentGridCell };
