/**
 * useQuestionBatches
 *
 * Discovers pending question batches from chat history and manages
 * batch-level pagination state.
 *
 * Lifecycle authority: the Rust `QuestionManager` broadcasts
 * `agent:interaction_finalized` on every terminal transition (user answered,
 * rejected, cancelled, timed out). `handleInteractionFinalized` merges that
 * into the backing `tool_call` event as a synthetic tool_result, flipping
 * `displayStatus` from `awaiting_user` to `completed`. `extractQuestionBatch`
 * naturally filters out `completed` events, so the card disappears the moment
 * the turn truly ends — no polling needed.
 *
 * Previously this hook also ran an aggressive `getPendingQuestions`-based
 * validate loop (periodic + falling-edge on isSessionActive) that dismissed
 * any batch the backend didn't currently list as pending. That mechanism
 * caused the card to vanish mid-question when `isSessionActive` briefly
 * flipped to idle for reasons unrelated to the turn actually ending:
 *   1. Session switch — `useSessionSync` forces `setSessionRuntimeStatus("idle")`
 *      on the incoming session before Rust pushes the real status.
 *   2. Dev hot-reload / Rust restart — process loses its in-memory
 *      `QuestionManager` entries, so `getPendingQuestions` returns empty
 *      even though the persisted tool_call is still `awaiting_user`.
 *   3. Any other global-status bleed-over.
 * Each of these made the hook dismiss a still-live interactive card.
 *
 * Removing the polling preserves the intended ask-user lifecycle: the only
 * lifecycle primitive is the
 * Promise / finalize event, not a client-side cache reconciliation.
 */
import { useAtomValue } from "jotai";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useChatHistory } from "@src/contexts/workspace/ChatContext";
import { editTruncationTimestampAtom } from "@src/engines/SessionCore";

import {
  extractQuestionBatch,
  isAskUserQuestionsEvent,
} from "./extractQuestionBatch";
import type { QuestionBatch } from "./types";

export interface UseQuestionBatchesReturn {
  pendingBatches: QuestionBatch[];
  batchIndex: number;
  currentBatch: QuestionBatch | undefined;
  setBatchIndex: Dispatch<SetStateAction<number>>;
  dismissBatch: (questionId: string) => void;
  /**
   * True when an ask_user_questions tool call is in-flight but its
   * `args.questions` payload has not streamed far enough for
   * `extractQuestionBatch` to produce a renderable batch yet. AskQuestionCard
   * uses this to show a loading shell instead of staying hidden during the
   * streaming gap.
   */
  isStreaming: boolean;
}

export function useQuestionBatches(): UseQuestionBatchesReturn {
  const { chatHistory } = useChatHistory();
  const editTruncation = useAtomValue(editTruncationTimestampAtom);

  // Each dismissal is tagged with the editTruncation value that was active
  // at dismiss time. When a rollback/edit changes the truncation, old
  // dismissals are invalidated so the card doesn't permanently hide a
  // question that re-appeared in the new timeline.
  const [dismissedMap, setDismissedMap] = useState<Map<string, string | null>>(
    () => new Map()
  );

  const dismissBatch = useCallback(
    (questionId: string) => {
      setDismissedMap((prev) => {
        const next = new Map(prev);
        next.set(questionId, editTruncation);
        return next;
      });
    },
    [editTruncation]
  );

  const pendingBatches = useMemo(() => {
    const batches: QuestionBatch[] = [];
    const seenIds = new Set<string>();
    for (const item of chatHistory) {
      const batch = extractQuestionBatch(item);
      if (!batch) continue;
      if (batch.questionId && seenIds.has(batch.questionId)) continue;
      const dismissTruncation = dismissedMap.get(batch.questionId);
      if (
        dismissTruncation !== undefined &&
        dismissTruncation === editTruncation
      )
        continue;
      if (batch.questionId) seenIds.add(batch.questionId);
      batches.push(batch);
    }
    return batches;
  }, [chatHistory, dismissedMap, editTruncation]);

  // Streaming detection: an ask_user_questions event whose args.questions
  // payload hasn't reached "has at least one question with text" yet. The
  // parser returns null for those, so they don't appear in `pendingBatches`,
  // but we still want to render a loading shell.
  const streamingCount = useMemo(() => {
    let count = 0;
    for (const event of chatHistory) {
      if (!isAskUserQuestionsEvent(event)) continue;
      // Already renderable — handled by the normal batch path.
      if (extractQuestionBatch(event)) continue;
      // Terminal: nothing to wait for.
      if (
        event.displayStatus === "completed" ||
        event.displayStatus === "failed"
      ) {
        continue;
      }
      const result = event.result as Record<string, unknown> | undefined;
      if (result?.success === true) continue;
      if (result?.error) continue;
      count += 1;
    }
    return count;
  }, [chatHistory]);

  const [rawBatchIndex, setBatchIndex] = useState(0);
  const batchIndex = useMemo(() => {
    if (pendingBatches.length === 0) return 0;
    return Math.min(rawBatchIndex, pendingBatches.length - 1);
  }, [rawBatchIndex, pendingBatches.length]);

  const currentBatch = pendingBatches[batchIndex];

  return {
    pendingBatches,
    batchIndex,
    currentBatch,
    setBatchIndex,
    dismissBatch,
    isStreaming: pendingBatches.length === 0 && streamingCount > 0,
  };
}
