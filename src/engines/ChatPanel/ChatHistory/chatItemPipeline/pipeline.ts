/**
 * Chat Item Pipeline — Main Processing Function
 *
 * Transforms SessionEvent[] into display-ready OptimizedChatItem[]:
 * - Pre-filters events that won't render content
 * - Deduplicates running/completed tool_call pairs
 * - Groups consecutive read file events
 * - Groups consecutive exploration tool calls
 * - Stacks consecutive browser actions
 * - Consolidates partial observations
 *
 * @module chatItemPipeline/pipeline
 */
import {
  createActionSummaryGroupId,
  createActivityStackGroupId,
  createReadFileGroupId,
} from "@/src/engines/SessionCore/sync/utils/activityIds";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  type ActionSummaryCategory,
  getActionSummaryCategory,
  isBrowserEvent,
  isManageTodoEvent,
  isReadFileEvent,
} from "./classifiers";
import { buildDedupMaps } from "./dedup";
import { willEventRenderContent } from "./filters";
import {
  type ActionSummaryEntry,
  type ChatHistoryStats,
  type ChatItemPipelineOptions,
  DEFAULT_PIPELINE_OPTIONS,
  type OptimizedChatItem,
} from "./types";
import { canConsolidate, mergeObservations } from "./utils";

// ============================================
// Error dedup helpers (pipeline-local, no blocks dependency)
// ============================================

function getErrorText(result: Record<string, unknown>): string | null {
  if (result.error && typeof result.error === "string") return result.error;
  if (result.error_message && typeof result.error_message === "string")
    return result.error_message;
  const text =
    typeof result.content === "string"
      ? result.content
      : typeof result.observation === "string"
        ? result.observation
        : null;
  // Only match explicit "error:" prefix (with colon), not bare "error " which
  // appears in success messages like "error: 0 issues found".
  if (text && /^error:/i.test(text)) return text;
  return null;
}

function isFailedToolCall(event: SessionEvent): boolean {
  if (event.actionType !== "tool_call") return false;
  const result = event.result;
  if (!result) return false;
  if (result.success === false || result.is_error === true) return true;
  if (result.error || result.error_message) return true;
  return getErrorText(result) !== null;
}

// ============================================
// Main Pipeline Function
// ============================================

/**
 * Process SessionEvent[] into display-ready OptimizedChatItem[].
 */
export function processChatItems(
  events: SessionEvent[],
  options: ChatItemPipelineOptions = {}
): { items: OptimizedChatItem[]; stats: ChatHistoryStats } {
  const opts = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  const result: OptimizedChatItem[] = [];

  const stats: ChatHistoryStats = {
    totalActivities: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
  };

  let readFileBuffer: SessionEvent[] = [];
  let actionSummaryBuffer: {
    category: ActionSummaryCategory;
    event: SessionEvent;
  }[] = [];
  let browserBuffer: SessionEvent[] = [];
  let partialBuffer: { event: SessionEvent; item: OptimizedChatItem }[] = [];

  // ------------------------------------------
  // Helper: create a simple activity OptimizedChatItem from an event
  // ------------------------------------------
  const eventToItem = (event: SessionEvent): OptimizedChatItem => ({
    chunk_id: event.id,
    type: "activity",
    event,
  });

  // ------------------------------------------
  // Buffer flush functions
  // ------------------------------------------

  const flushReadFileBuffer = () => {
    if (readFileBuffer.length === 0) return;

    if (
      opts.groupReadFileActivities &&
      readFileBuffer.length >= (opts.minReadFilesToGroup || 2)
    ) {
      const firstRead = readFileBuffer[0];
      result.push({
        chunk_id: createReadFileGroupId(firstRead.id),
        type: "readFileGroup",
        readFileEvents: [...readFileBuffer],
      });
    } else {
      readFileBuffer.forEach((event) => {
        result.push(eventToItem(event));
      });
    }
    readFileBuffer = [];
  };

  const flushActionSummaryBuffer = (closedByBoundary = true) => {
    if (actionSummaryBuffer.length === 0) return;

    const minToGroup = opts.minActionSummaryToGroup || 2;
    if (opts.groupActionSummaries && actionSummaryBuffer.length >= minToGroup) {
      const entriesByCategory = new Map<
        ActionSummaryCategory,
        SessionEvent[]
      >();
      for (const { category, event } of actionSummaryBuffer) {
        const existing = entriesByCategory.get(category);
        if (existing) {
          existing.push(event);
        } else {
          entriesByCategory.set(category, [event]);
        }
      }

      const entries: ActionSummaryEntry[] = [];
      for (const [category, evts] of entriesByCategory) {
        entries.push({ category, events: evts });
      }

      const firstEvent = actionSummaryBuffer[0].event;
      result.push({
        chunk_id: createActionSummaryGroupId(firstEvent.id),
        type: "actionSummaryGroup",
        actionSummaryEntries: entries,
        actionSummaryItems: [...actionSummaryBuffer],
        actionSummaryClosedByBoundary: closedByBoundary,
      });
    } else {
      for (const { event } of actionSummaryBuffer) {
        result.push(eventToItem(event));
      }
    }
    actionSummaryBuffer = [];
  };

  const flushBrowserBuffer = () => {
    if (browserBuffer.length === 0) return;

    if (opts.stackBrowserActions) {
      const firstBrowser = browserBuffer[0];
      result.push({
        chunk_id: createActivityStackGroupId("browser", firstBrowser.id),
        type: "activityStackGroup",
        activityStackGroup: {
          category: "browser",
          events: [...browserBuffer],
        },
      });
    } else {
      browserBuffer.forEach((event) => {
        result.push(eventToItem(event));
      });
    }
    browserBuffer = [];
  };

  const flushPartialBuffer = () => {
    if (partialBuffer.length === 0) return;

    if (opts.consolidatePartialObservations && partialBuffer.length > 1) {
      const bufferEvents = partialBuffer.map((entry) => entry.event);
      const mergedObservation = mergeObservations(bufferEvents);
      const firstEvent = bufferEvents[0];

      result.push({
        ...partialBuffer[0].item,
        event: {
          ...firstEvent,
          result: {
            ...firstEvent.result,
            observation: mergedObservation,
          },
        },
        consolidatedParts: partialBuffer.length,
      });
    } else {
      result.push(...partialBuffer.map((entry) => entry.item));
    }
    partialBuffer = [];
  };

  const flushAllBuffers = () => {
    flushActionSummaryBuffer();
    flushReadFileBuffer();
    flushBrowserBuffer();
    flushPartialBuffer();
  };

  // ------------------------------------------
  // Pre-pass: dedup running tool_call chunks + assistant messages
  // ------------------------------------------
  const {
    runningChunksToSkip,
    runningArgsMap,
    duplicateAssistantIds,
    duplicateUserIds,
  } = buildDedupMaps(events);

  // ------------------------------------------
  // Main processing loop
  // ------------------------------------------
  let sawManageTodo = false;

  for (let index = 0; index < events.length; index++) {
    const event = events[index];

    if (
      runningChunksToSkip.has(event.id) ||
      duplicateAssistantIds.has(event.id) ||
      duplicateUserIds.has(event.id)
    ) {
      continue;
    }

    // Merge args from running event into result events with empty args
    if (
      event.actionType === "tool_call" &&
      (!event.args || Object.keys(event.args).length === 0)
    ) {
      const resultCallId =
        event.callId || (event.result?.call_id as string | undefined);
      if (resultCallId) {
        const runningArgs = runningArgsMap.get(resultCallId);
        if (runningArgs) {
          (event as { args: Record<string, unknown> }).args = {
            ...runningArgs,
          };
        }
      }
    }

    // Pre-filter: Skip events that won't render any content
    if (opts.preFilterEmptyActivities) {
      if (!willEventRenderContent(event)) {
        continue;
      }
    }

    // Caller-supplied skip predicate (e.g. drop diff events when the Diff
    // simulator app is active).
    if (opts.shouldSkipEvent && opts.shouldSkipEvent(event)) {
      continue;
    }

    // Filter out manage_todo events and the plan-detail assistant_message that follows
    if (opts.filterManageTodo) {
      if (isManageTodoEvent(event)) {
        sawManageTodo = true;
        continue;
      }
      if (
        sawManageTodo &&
        event.actionType === "assistant" &&
        event.functionName === "assistant_message"
      ) {
        sawManageTodo = false;
        continue;
      }
      sawManageTodo = false;
    }

    // Count total activities once per surviving raw event — independent of
    // whether the event later lands in the result as its own item, gets
    // folded into a buffer (action-summary / read-file / browser-stack /
    // partial-observation), or gets folded into a repeated-error sibling.
    // success/failed/pending counts stay tied to result-array entries
    // below so they remain consistent with what users actually see.
    if (event.id !== "loading") {
      stats.totalActivities++;
    }

    // Buffer: action summary (exploration tool calls: read, search, glob, list)
    if (opts.groupActionSummaries) {
      const summaryCategory = getActionSummaryCategory(event);
      if (summaryCategory && !isFailedToolCall(event)) {
        flushBrowserBuffer();
        flushPartialBuffer();
        flushReadFileBuffer();
        actionSummaryBuffer.push({ category: summaryCategory, event });
        continue;
      } else {
        flushActionSummaryBuffer();
      }
    }

    // Buffer: read file events (only when action summaries are disabled)
    if (!opts.groupActionSummaries && isReadFileEvent(event)) {
      flushBrowserBuffer();
      flushPartialBuffer();
      readFileBuffer.push(event);
      continue;
    } else if (!opts.groupActionSummaries) {
      flushReadFileBuffer();
    }

    // Buffer: browser actions
    if (isBrowserEvent(event)) {
      flushPartialBuffer();
      browserBuffer.push(event);
      continue;
    } else {
      flushBrowserBuffer();
    }

    // Buffer: partial observations
    const obsPart = event.args?.observation_part as string;
    if (obsPart && opts.consolidatePartialObservations) {
      const lastPartial = partialBuffer[partialBuffer.length - 1];
      const lastEvent = lastPartial?.event;

      const item = eventToItem(event);
      if (lastEvent && canConsolidate(lastEvent, event)) {
        partialBuffer.push({ event, item });
        continue;
      } else {
        flushPartialBuffer();
        partialBuffer.push({ event, item });
        continue;
      }
    } else {
      flushPartialBuffer();
    }

    // Regular event — flush all buffers and add as activity
    flushAllBuffers();

    // Fold consecutive identical tool errors into a single item with a repeat count.
    // repeatedErrorCount stores the number of extra occurrences beyond the first
    // (i.e. total occurrences = repeatedErrorCount + 1). Stats are only counted
    // for items that actually land in the result array, so folded duplicates are
    // excluded — this keeps stats.failedCount consistent with result.length.
    if (isFailedToolCall(event)) {
      const last = result[result.length - 1];
      if (
        last?.type === "activity" &&
        last.event &&
        last.event.functionName === event.functionName &&
        last.event.actionType === "tool_call" &&
        isFailedToolCall(last.event) &&
        getErrorText(last.event.result ?? {}) ===
          getErrorText(event.result ?? {})
      ) {
        result[result.length - 1] = {
          ...last,
          repeatedErrorCount: (last.repeatedErrorCount ?? 1) + 1,
        };
        continue;
      }
    }

    // Count success / failed / pending only for events that actually land
    // in the result array as their own item. Folded error duplicates
    // (handled above via continue) are excluded so these counts stay
    // consistent with result.length-of-this-kind. (totalActivities was
    // bumped earlier — it tracks raw events including buffered ones.)
    if (event.id !== "loading") {
      const isSuccess = event.result?.success === true;
      const isFailed = event.result?.success === false;
      if (isSuccess) {
        stats.successCount++;
      } else if (isFailed) {
        stats.failedCount++;
      } else {
        stats.pendingCount++;
      }
    }

    result.push(eventToItem(event));
  }

  // Flush remaining buffers. A trailing action-summary buffer is still active,
  // so keep its stack expanded until a later non-summary event closes it.
  flushActionSummaryBuffer(false);
  flushReadFileBuffer();
  flushBrowserBuffer();
  flushPartialBuffer();

  return { items: result, stats };
}
