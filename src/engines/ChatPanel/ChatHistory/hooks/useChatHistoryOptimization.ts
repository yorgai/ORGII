/**
 * Chat History Optimization Hook
 *
 * Extracts optimization logic from ChatHistory component.
 * Handles:
 * - Deduplication of chat items (especially chatNotify)
 * - Merging failed activities
 * - Consolidating partial observations
 * - Inserting ThreadSelector items at the start of each execution round
 *
 * NOTE: Session/task lifecycle filtering (session_start, session_end,
 * task_start, task_completed, task_failed, stage_error) is handled by
 * Rust `is_visible_in_chat()` in derived.rs — events never reach the
 * frontend chatEventsAtom. JS mirror: visibilityFilters.ts.
 */
import { useAtomValue } from "jotai";
import { useDeferredValue, useMemo } from "react";

import type { SessionInfo } from "@src/engines/ChatPanel/ChatItems/SessionHeader";
import {
  THREAD_LIFECYCLE_ACTIONS,
  formatThreadDisplayName,
} from "@src/engines/ChatPanel/ThreadSelector/config";
import type { ExecutionThread } from "@src/engines/ChatPanel/ThreadSelector/types";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getActionChatBlock } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { selectedExecutionThreadAtom } from "@src/store/ui/sessionPaginationAtom";

import { processChatItems } from "../chatItemPipeline";
import type { OptimizedChatItem } from "../chatItemPipeline/types";

function isDiffEventForFilter(event: SessionEvent): boolean {
  const toolName = event.uiCanonical || event.functionName;
  if (!toolName) return false;
  const action = event.args?.action;
  const actionStr = typeof action === "string" ? action : undefined;
  return getActionChatBlock(toolName, actionStr) === "diff";
}

// ============================================
// Phase 3 helpers — pure functions, no hooks
// ============================================

/** Check if a threaded activity item belongs to a filtered-out thread */
const isFilteredOut = (
  item: OptimizedChatItem,
  selectedThreadId: string | null
): boolean => {
  if (!selectedThreadId) return false;
  if (item.type !== "activity" || !item.event) return false;
  if (!item.event.threadId) return false;
  return item.event.threadId !== selectedThreadId;
};

/**
 * Filter pipeline output by selected thread.
 * Handles individual items AND group items (readFileGroup,
 * activityStackGroup) by filtering their inner arrays.
 */
function filterByThread(
  items: OptimizedChatItem[],
  selectedThreadId: string | null
): OptimizedChatItem[] {
  if (!selectedThreadId) return items;

  const result: OptimizedChatItem[] = [];

  for (const item of items) {
    if (item.type !== "activity") {
      if (item.readFileEvents) {
        const filtered = item.readFileEvents.filter(
          (ev) => !ev.threadId || ev.threadId === selectedThreadId
        );
        if (filtered.length === 0) continue;
        result.push({ ...item, readFileEvents: filtered });
        continue;
      }
      if (item.activityStackGroup) {
        const filtered = item.activityStackGroup.events.filter(
          (ev) => !ev.threadId || ev.threadId === selectedThreadId
        );
        if (filtered.length === 0) continue;
        result.push({
          ...item,
          activityStackGroup: {
            ...item.activityStackGroup,
            events: filtered,
          },
        });
        continue;
      }
      result.push(item);
      continue;
    }

    if (!isFilteredOut(item, selectedThreadId)) {
      result.push(item);
    }
  }

  return result;
}

/**
 * Insert ThreadSelector synthetic items at execution round boundaries.
 * Uses pre-computed executionRounds metadata for O(rounds) lookup.
 */
function insertThreadSelectors(
  pipelineItems: OptimizedChatItem[],
  rawEvents: SessionEvent[],
  executionRounds: ExecutionRoundInfo[],
  selectedThreadId: string | null
): OptimizedChatItem[] {
  if (executionRounds.length === 0) return pipelineItems;

  const selectors: OptimizedChatItem[] = executionRounds
    .filter((round) => round.threads.size > 0)
    .map((round) => {
      const threadsArray: ExecutionThread[] = Array.from(
        round.threads.entries()
      ).map(([threadId, info]) => ({
        threadId,
        displayName: formatThreadDisplayName(threadId),
        isActive: selectedThreadId === threadId,
        eventCount: info.eventCount,
        isCompleted: info.hasEnd,
        isRunning: info.hasStart && !info.hasEnd,
      }));

      const threadFirstEventMap = new Map<string, string>();
      round.threads.forEach((info, threadId) => {
        if (info.firstEventId) {
          threadFirstEventMap.set(threadId, info.firstEventId);
        }
      });

      return {
        type: "threadSelector",
        chunk_id: `thread-selector-round-${round.roundNumber}`,
        threadSelectorData: {
          roundNumber: round.roundNumber,
          threads: threadsArray,
          threadFirstEventMap,
        },
      } as OptimizedChatItem;
    });

  if (selectors.length === 0) return pipelineItems;

  const result: OptimizedChatItem[] = [];
  let selectorIdx = 0;
  let insertedForCurrentSection = false;

  for (const item of pipelineItems) {
    const isThreadActivity =
      item.type === "activity" && Boolean(item.event?.threadId);

    if (!isThreadActivity) {
      insertedForCurrentSection = false;
    }

    if (
      selectorIdx < selectors.length &&
      !insertedForCurrentSection &&
      isThreadActivity
    ) {
      result.push(selectors[selectorIdx]);
      selectorIdx++;
      insertedForCurrentSection = true;
    }

    result.push(item);
  }

  while (selectorIdx < selectors.length) {
    result.push(selectors[selectorIdx++]);
  }

  return result;
}

/** Thread metadata collected per execution round */
interface ThreadInfo {
  eventCount: number;
  hasStart: boolean;
  hasEnd: boolean;
  firstEventId: string;
  firstEventTime: string;
}

/** Execution round metadata — computed once per chatHistory change */
interface ExecutionRoundInfo {
  roundNumber: number;
  startIndex: number;
  threads: Map<string, ThreadInfo>;
}

// ============================================
// Return Type
// ============================================

export interface UseChatHistoryOptimizationReturn {
  optimizedChatHistory: OptimizedChatItem[];
  sessionInfo: SessionInfo | null;
}

// ============================================
// Hook
// ============================================

export function useChatHistoryOptimization(
  chatEvents: SessionEvent[],
  options: { skipDiffEvents?: boolean } = {}
): UseChatHistoryOptimizationReturn {
  const selectedThreadId = useAtomValue(selectedExecutionThreadAtom);
  const skipDiffEvents = options.skipDiffEvents === true;

  // During active streaming Rust pushes es:changed on every delta, which
  // would trigger a full O(n) pipeline recompute on every token. Deferring
  // the expensive computation steps (executionRounds, basePipeline,
  // optimizedChatHistory) to low priority lets React batch them and skip
  // intermediate renders — the chat still updates because ChatHistory reads
  // chatEvents directly for the scrolling cursor, while the heavy pipeline
  // catches up after the burst.
  const deferredChatEvents = useDeferredValue(chatEvents);
  const optimizationEvents = useMemo(() => {
    const latestLastEventId = chatEvents[chatEvents.length - 1]?.id;
    const deferredLastEventId =
      deferredChatEvents[deferredChatEvents.length - 1]?.id;
    const deferredIsStale =
      deferredChatEvents.length < chatEvents.length ||
      latestLastEventId !== deferredLastEventId;
    return deferredIsStale ? chatEvents : deferredChatEvents;
  }, [chatEvents, deferredChatEvents]);

  // Extract session info from session_start events
  const sessionInfo = useMemo<SessionInfo | null>(() => {
    const sessionStartEvent = optimizationEvents.find(
      (event) => event.actionType === "session_start"
    );

    if (!sessionStartEvent) return null;

    return {
      sessionId: sessionStartEvent.sessionId,
      model:
        (sessionStartEvent.args?.model as string) ||
        (sessionStartEvent.result?.model as string) ||
        "",
      workspace:
        (sessionStartEvent.args?.cwd as string) ||
        (sessionStartEvent.args?.workspace as string) ||
        "",
      startedAt: sessionStartEvent.createdAt,
    };
  }, [optimizationEvents]);

  // Step 1: Detect execution rounds and collect thread metadata.
  const executionRounds = useMemo<ExecutionRoundInfo[]>(() => {
    const rounds: ExecutionRoundInfo[] = [];
    let currentRound: ExecutionRoundInfo | null = null;
    let inThreadSection = false;

    for (let index = 0; index < optimizationEvents.length; index++) {
      const event = optimizationEvents[index];
      const threadId = event.threadId;
      const actionType = event.actionType;
      const createdAt = event.createdAt;

      if (threadId) {
        if (!inThreadSection) {
          inThreadSection = true;
          currentRound = {
            roundNumber: rounds.length + 1,
            startIndex: index,
            threads: new Map(),
          };
          rounds.push(currentRound);
        }

        if (currentRound) {
          const existing = currentRound.threads.get(threadId) || {
            eventCount: 0,
            hasStart: false,
            hasEnd: false,
            firstEventId: event.id || "",
            firstEventTime: createdAt || "",
          };
          existing.eventCount += 1;

          if (
            createdAt &&
            (!existing.firstEventTime || createdAt < existing.firstEventTime)
          ) {
            existing.firstEventTime = createdAt;
            existing.firstEventId = event.id || "";
          }

          if (actionType === THREAD_LIFECYCLE_ACTIONS.start) {
            existing.hasStart = true;
          }
          if (actionType === THREAD_LIFECYCLE_ACTIONS.end) {
            existing.hasEnd = true;
          }
          currentRound.threads.set(threadId, existing);
        }
      } else if (actionType === "session_end") {
        inThreadSection = false;
        currentRound = null;
      }
    }

    return rounds;
  }, [optimizationEvents]);

  const effectiveSelectedThreadId = useMemo(() => {
    if (!selectedThreadId) return null;
    return optimizationEvents.some(
      (event) => event.threadId === selectedThreadId
    )
      ? selectedThreadId
      : null;
  }, [optimizationEvents, selectedThreadId]);

  // Phase 2: Base pipeline (thread-INDEPENDENT)
  const basePipelineItems = useMemo(() => {
    const optimized = processChatItems(optimizationEvents, {
      consolidatePartialObservations: true,
      shouldSkipEvent: skipDiffEvents ? isDiffEventForFilter : undefined,
    });
    return optimized.items;
  }, [optimizationEvents, skipDiffEvents]);

  // Phase 3: Thread filter + selector insertion (thread-DEPENDENT)
  const optimizedChatHistory = useMemo(() => {
    const threadFiltered = filterByThread(
      basePipelineItems,
      effectiveSelectedThreadId
    );

    const withSelectors = insertThreadSelectors(
      threadFiltered,
      optimizationEvents,
      executionRounds,
      effectiveSelectedThreadId
    );

    return withSelectors;
  }, [
    basePipelineItems,
    effectiveSelectedThreadId,
    executionRounds,
    optimizationEvents,
  ]);

  return {
    optimizedChatHistory,
    sessionInfo,
  };
}
