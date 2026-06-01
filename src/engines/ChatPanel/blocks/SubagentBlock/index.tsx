/**
 * SubagentBlock — session-in-session card for subagent tool calls.
 *
 * Uses the same EventBlockHeader / EventBlockHeaderIcon chrome as
 * TerminalBlock for a consistent expand/collapse experience.
 *
 * Visual states:
 *   1. **Running** — spinner icon, shimmer title, Stop button visible.
 *   2. **Success** — agent icon, summary in collapsed body.
 *   3. **Failed / cancelled** — alert icon, error in collapsed body.
 *
 * Helper functions and sub-components (StreamingReasoning, PinnedPrompt,
 * PromptWithTodos) live in SubagentHelpers.tsx.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircle, Square } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Markdown from "@src/components/MarkDown";
import { getToolIcon } from "@src/config/toolIcons";
import {
  mainReplayCursorMsAtom,
  replayModeAtom,
} from "@src/engines/SessionCore";
import { useSessionEvents } from "@src/engines/SessionCore/core/store/useSessionEvents";
import { findIndexAtTime } from "@src/engines/Simulator/hooks/cellReplayTypes";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import {
  focusedSubagentCellAtom,
  simulatorSelectedAppAtom,
  subagentPanelRevealRequestAtom,
} from "@src/store/ui/simulatorAtom";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import {
  EVENT_LOADING_SHIMMER_TEXT_CLASSES,
  EventBlockHeader,
  EventBlockHeaderIcon,
  SESSION_UI_TOKENS,
  getEventBlockContainerClasses,
} from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import NestedActivityList from "./NestedActivityList";
import {
  PromptWithTodos,
  StreamingReasoning,
  derivePeekFromEvents,
  extractSummary,
  formatElapsedTime,
} from "./SubagentHelpers";
import SubagentTodoPinBar, { deriveLatestTodos } from "./SubagentTodoPinBar";

// ============================================
// Types
// ============================================

export interface SubagentBlockProps {
  description: string;
  subagentType?: string;
  resultContent?: string;
  resultSummary?: string;
  isLoading?: boolean;
  defaultCollapsed?: boolean;
  elapsedMs?: number;
  subagentSessionId?: string;
  prompt?: string;
  status?: "pending" | "running" | "success" | "failed" | "cancelled";
  success?: boolean;
  errorMessage?: string;
  eventId?: string;
}

// ============================================
// Main Component
// ============================================

const SubagentBlock: React.FC<SubagentBlockProps> = memo(
  ({
    description,
    subagentType,
    resultContent,
    resultSummary,
    isLoading = false,
    defaultCollapsed = true,
    elapsedMs,
    subagentSessionId,
    prompt,
    status,
    success,
    errorMessage,
    eventId,
  }) => {
    const { t } = useTranslation("sessions");
    const { t: tCommon } = useTranslation();

    const hasContent = Boolean(
      resultContent && resultContent.trim().length > 0
    );
    const hasNestedSession = Boolean(subagentSessionId);
    const hasPrompt = Boolean(prompt && prompt.trim().length > 0);
    const hasErrorMessage = Boolean(
      errorMessage && errorMessage.trim().length > 0
    );
    const isFailure =
      status === "failed" ||
      status === "cancelled" ||
      (status !== "running" && success === false);

    const canExpand =
      hasNestedSession || hasContent || hasErrorMessage || hasPrompt;

    const effectiveDefaultCollapsed = isFailure
      ? false
      : isLoading
        ? false
        : defaultCollapsed;

    const {
      isCollapsed,
      setIsCollapsed,
      isHeaderHovered,
      handleHeaderClick,
      handleHeaderMouseEnter,
      handleHeaderMouseLeave,
      handleLocate: rawHandleLocate,
    } = useBlockHeader({
      defaultCollapsed: effectiveDefaultCollapsed,
      eventId,
      collapseAllValue: true,
    });

    // Force-expand when running or failed regardless of persisted collapse state.
    // collapseStateAtom persists per-eventId, so a previously collapsed block
    // stays collapsed on re-render even when isLoading/isFailure is true.
    useEffect(() => {
      if (isLoading || isFailure) {
        setIsCollapsed(false);
      }
    }, [isLoading, isFailure, setIsCollapsed]);

    const scrollRef = useRef<HTMLDivElement>(null);

    const setFocusedCell = useSetAtom(focusedSubagentCellAtom);
    const requestPanelReveal = useSetAtom(subagentPanelRevealRequestAtom);
    const setSelectedApp = useSetAtom(simulatorSelectedAppAtom);
    const setReplayMode = useSetAtom(replayModeAtom);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout>>();

    const handleLocate = useCallback(() => {
      rawHandleLocate?.();
      if (!subagentSessionId) return;
      // Cursor IDE history child composers don't appear in the live
      // BACKGROUND_TASKS panel (it's fed from `agent_sessions` DB, not
      // Cursor's `state.vscdb`). Locate would jump to an empty panel and
      // break the user's flow — skip the deep-link and let the header
      // toggle handle expand/collapse instead. Nested events still render
      // inline because `useSessionEvents` can resolve cursoride-* ids via
      // `ensureCursorIdeEventsInStore`.
      if (isCursorIdeSession(subagentSessionId)) return;
      setSelectedApp(AppType.BACKGROUND_TASKS);
      setReplayMode("replay");
      setFocusedCell(subagentSessionId);
      requestPanelReveal((prev) => prev + 1);
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = setTimeout(() => setFocusedCell(null), 3000);
    }, [
      rawHandleLocate,
      subagentSessionId,
      setFocusedCell,
      requestPanelReveal,
      setSelectedApp,
      setReplayMode,
    ]);

    useEffect(() => {
      return () => clearTimeout(focusTimerRef.current);
    }, []);

    const expanded = !isCollapsed;

    const { events: nestedEvents, loading: nestedLoading } =
      useSessionEvents(subagentSessionId);

    // ── Replay cursor wiring ──
    //
    // When the user is scrubbing the main drag bar, mirror the cursor into
    // the child session: every derived view (peek, todos, list, prompt
    // todos) reads from a sliced prefix of `nestedEvents` so that the
    // subagent appears in the state it was in at the cursor's timestamp.
    //
    // `mainReplayCursorMsAtom` is null when no event is selected (live
    // tail / initial mount). It's set whenever `currentEventIdAtom` is set,
    // which includes both explicit user clicks ("locate" / "go to event")
    // and the slider's index-driven navigation. Gate on
    // `replayModeAtom === "replay"` so that follow mode never clips — the
    // user expects live tail to keep appending without retroactive hiding.
    const replayMode = useAtomValue(replayModeAtom);
    const mainCursorMs = useAtomValue(mainReplayCursorMsAtom);
    const inReplayMode = replayMode === "replay" && mainCursorMs != null;
    const externalCursorMs = inReplayMode ? mainCursorMs : null;

    const visibleNestedEvents = useMemo(() => {
      if (externalCursorMs == null || nestedEvents.length === 0) {
        return nestedEvents;
      }
      const firstMs = new Date(nestedEvents[0].createdAt).getTime();
      // Cursor is strictly before the child's first event — render the
      // block in its "not yet started" shape (empty nested list + no
      // pin-bar / todo derivations).
      if (externalCursorMs < firstMs) return [];
      const idx = findIndexAtTime(nestedEvents, externalCursorMs);
      if (idx < 0) return [];
      return nestedEvents.slice(0, idx + 1);
    }, [nestedEvents, externalCursorMs]);

    // Auto-expand when the subagent starts producing events so the user sees
    // live progress without having to manually open the block. Suppressed in
    // replay mode so scrubbing doesn't clobber the user's collapse state on
    // every cursor move — and so a block whose child has events but whose
    // cursor is pre-spawn doesn't pop open into an empty body.
    useEffect(() => {
      if (inReplayMode) return;
      if (isLoading && nestedEvents.length > 0) {
        setIsCollapsed(false);
      }
    }, [inReplayMode, isLoading, nestedEvents.length, setIsCollapsed]);

    // Scroll to bottom whenever new events arrive while the block is
    // expanded. Suppressed in replay mode — scrubbing backward would
    // otherwise re-scroll to the bottom on every cursor change.
    useEffect(() => {
      if (!expanded) return;
      if (inReplayMode) return;
      const el = scrollRef.current;
      if (!el) return;
      const rafId = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return () => cancelAnimationFrame(rafId);
    }, [expanded, inReplayMode, nestedEvents.length]);

    const effectiveReasoning = useMemo(
      () => (isLoading ? derivePeekFromEvents(visibleNestedEvents) : ""),
      [isLoading, visibleNestedEvents]
    );

    const summary = useMemo(
      () => resultSummary || extractSummary(resultContent || ""),
      [resultSummary, resultContent]
    );

    const timingLabel = elapsedMs ? formatElapsedTime(elapsedMs) : undefined;

    // ── Stop button ──
    const [isStopping, setIsStopping] = useState(false);
    const effectiveIsStopping = isStopping && isLoading;
    const canStop = isLoading && hasNestedSession;

    useEffect(() => {
      if (!isLoading) setIsStopping(false);
    }, [isLoading]);

    const handleStop = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!subagentSessionId || effectiveIsStopping) return;
        setIsStopping(true);
        try {
          const { CANCEL_REASON, cancelSession } =
            await import("@src/api/tauri/agent/session");
          await cancelSession(
            subagentSessionId,
            CANCEL_REASON.PROGRAMMATIC_SHUTDOWN
          );
        } catch (err) {
          console.error("Failed to cancel subagent:", err);
          setIsStopping(false);
        }
      },
      [subagentSessionId, effectiveIsStopping]
    );

    // ── Subtitle text ──
    const subtitleParts: string[] = [];
    if (isFailure) subtitleParts.push(t("tools.subagentFailed"));
    if (timingLabel && !isLoading) subtitleParts.push(timingLabel);
    if (subagentType) subtitleParts.push(subagentType);
    const subtitle = subtitleParts.join(" · ");

    // ── Header icon ──
    const headerIcon = isFailure ? (
      <AlertCircle size={14} strokeWidth={1.75} className="text-danger-5" />
    ) : (
      getToolIcon("agent", { size: 14, className: "text-text-2" })
    );

    // ── Todo progress for header ──
    //
    // Derive from the cursor-sliced list so the "N of M" badge reflects the
    // task state at the cursor, not the final state.
    const todoProgress = useMemo(() => {
      const todos = deriveLatestTodos(visibleNestedEvents);
      if (todos.length === 0) return null;
      const completed = todos.filter((td) =>
        td.status.toLowerCase().includes("completed")
      ).length;
      return { completed, total: todos.length };
    }, [visibleNestedEvents]);

    // ── Header right: todo badge + stop ──
    const headerRight = (
      <div className="flex items-center gap-2 pl-2">
        {todoProgress && (
          <span className="shrink-0 text-[11px] font-medium tabular-nums text-text-3">
            {todoProgress.completed} of {todoProgress.total}
          </span>
        )}
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
    );

    const displayTitle = description || t("tools.subagentDefaultName");

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
            icon={headerIcon}
            isCollapsed={isCollapsed}
            isHeaderHovered={isHeaderHovered}
            onToggle={handleHeaderClick}
            hasContent={canExpand}
            revealChevronOnIconHoverOnly={Boolean(eventId)}
            isLoading={isLoading}
            isFailed={isFailure}
          />
          <span
            className={`min-w-0 shrink truncate font-medium ${isLoading ? EVENT_LOADING_SHIMMER_TEXT_CLASSES : isFailure ? "text-text-3" : "text-text-1"}`}
            title={displayTitle}
          >
            {displayTitle}
          </span>
          {subtitle && (
            <span
              className={`shrink-0 ${isLoading ? EVENT_LOADING_SHIMMER_TEXT_CLASSES : isFailure ? "text-danger-5" : "text-text-3"}`}
            >
              {subtitle}
            </span>
          )}
        </EventBlockHeader>

        {/* ── Collapsed body ── */}
        {isCollapsed && isFailure && hasErrorMessage && (
          <div
            className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed text-danger-5`}
          >
            {errorMessage}
          </div>
        )}

        {isCollapsed && !isFailure && !isLoading && summary && (
          <div
            className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed ${SESSION_UI_TOKENS.TEXT.SECONDARY}`}
          >
            {summary}
          </div>
        )}

        {isLoading && effectiveReasoning && isCollapsed && (
          <StreamingReasoning text={effectiveReasoning} />
        )}

        {isLoading && !effectiveReasoning && isCollapsed && (
          <div
            className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`}
          >
            {t("tools.runningSubagent")}
          </div>
        )}

        {/* ── Expanded body ── */}
        {expanded && (
          <div className="animate-fade-in">
            <div
              ref={scrollRef}
              className="max-h-[30vh] overflow-y-auto scrollbar-hide"
            >
              {hasPrompt && (
                <PromptWithTodos
                  prompt={prompt as string}
                  events={hasNestedSession ? visibleNestedEvents : []}
                />
              )}

              {!hasPrompt &&
                hasNestedSession &&
                visibleNestedEvents.length > 0 && (
                  <div className="px-3.5 pt-2">
                    <SubagentTodoPinBar events={visibleNestedEvents} />
                  </div>
                )}

              {hasNestedSession && (
                <NestedActivityList
                  events={nestedEvents}
                  loading={nestedLoading || isLoading}
                  externalCursorMs={externalCursorMs}
                />
              )}

              {isFailure && hasErrorMessage && (
                <div className="border-t border-fill-3 px-3.5 py-2.5">
                  <div
                    className={`whitespace-pre-wrap break-words ${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed text-danger-5`}
                  >
                    {errorMessage}
                  </div>
                </div>
              )}

              {!isLoading && hasContent && (
                <div className="px-3.5 py-2.5">
                  <div
                    className={`${SESSION_UI_TOKENS.FONT_SIZE_SM} leading-relaxed ${SESSION_UI_TOKENS.TEXT.SECONDARY}`}
                  >
                    <Markdown
                      textContent={resultContent || ""}
                      useChatCodeBlock
                    />
                  </div>
                </div>
              )}

              {isLoading && !hasNestedSession && nestedEvents.length === 0 && (
                <div
                  className={`px-3.5 py-2.5 ${SESSION_UI_TOKENS.FONT_SIZE_SM} ${EVENT_LOADING_SHIMMER_TEXT_CLASSES}`}
                >
                  {t("tools.runningSubagent")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

SubagentBlock.displayName = "SubagentBlock";

export default SubagentBlock;
