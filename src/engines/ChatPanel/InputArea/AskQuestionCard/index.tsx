/**
 * AskQuestionCard Component
 *
 * Question card above InputArea: all questions in one scrollable column,
 * no per-question pagination. Optional batch navigation when multiple pending chunks.
 *
 * Features:
 * - Per-question single-select or multi-select with lettered badges
 * - Skip and Submit keyboard shortcuts
 * - Auto-skip countdown rendered from the backend's `autoResolveAt`
 *   deadline (presence policy). The backend is the resolver — the card
 *   only displays the remaining time.
 *
 * Submission logic shared via useQuestionSubmission.
 * Selection state shared via useOptionSelection.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { QuestionCardLoadingShell } from "./QuestionCardLoadingShell";
import { QuestionCardShell } from "./QuestionCardShell";
import type { AskQuestionCardProps } from "./types";
import { useOptionSelection } from "./useOptionSelection";
import { useQuestionBatches } from "./useQuestionBatches";
import { useQuestionSubmission } from "./useQuestionSubmission";

const AskQuestionCard: React.FC<AskQuestionCardProps> = ({
  forceVisible,
  collapsed,
  onCollapse,
  onHasDataChange,
}) => {
  const { t } = useTranslation("sessions");
  const { submitAnswers, skipQuestion, isSubmitting } = useQuestionSubmission();

  const { pendingBatches, currentBatch, dismissBatch, isStreaming } =
    useQuestionBatches();

  const customInputRefs = useRef<Map<number, HTMLTextAreaElement | null>>(
    new Map()
  );

  const registerCustomInput =
    (qIdx: number) => (el: HTMLTextAreaElement | null) => {
      if (el) customInputRefs.current.set(qIdx, el);
      else customInputRefs.current.delete(qIdx);
    };

  const {
    selections,
    customTexts,
    handleOptionClick,
    handleCustomTextChange,
    reset: resetSelections,
  } = useOptionSelection({
    scopeKey: currentBatch?.questionId,
  });

  // ============================================
  // Submit / Skip
  // ============================================

  const handleContinue = useCallback(async () => {
    if (!currentBatch) return;

    const success = await submitAnswers({
      sessionId: currentBatch.sessionId,
      questionId: currentBatch.questionId,
      chunkId: currentBatch.chunkId,
      questions: currentBatch.questions,
      selections,
      customTexts,
    });

    if (success) {
      dismissBatch(currentBatch.questionId);
      resetSelections();
    }
  }, [
    currentBatch,
    selections,
    customTexts,
    submitAnswers,
    dismissBatch,
    resetSelections,
  ]);

  const handleSkip = useCallback(async () => {
    if (!currentBatch) return;

    const success = await skipQuestion({
      sessionId: currentBatch.sessionId,
      questionId: currentBatch.questionId,
      chunkId: currentBatch.chunkId,
    });

    if (success) {
      dismissBatch(currentBatch.questionId);
      resetSelections();
    }
  }, [currentBatch, skipQuestion, dismissBatch, resetSelections]);

  // ============================================
  // Keyboard shortcuts
  // ============================================

  useEffect(() => {
    if (!currentBatch) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleSkip();
      } else if (event.key === "Enter" && !event.shiftKey) {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement && active.type === "text")
          return;
        const allAnswered = currentBatch.questions.every(
          (question, qIdx) =>
            question.options.length === 0 ||
            (selections.get(qIdx)?.size ?? 0) > 0
        );
        if (allAnswered) {
          event.preventDefault();
          handleContinue();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentBatch, selections, handleSkip, handleContinue]);

  // ============================================
  // Auto-skip countdown (display only)
  // ============================================
  //
  // The backend owns the auto-resolve deadline (presence policy) and
  // resolves the batch even when this card never renders. We only show
  // the remaining seconds from the `autoResolveAt` timestamp carried on
  // the question event. When the deadline fires, the backend's
  // interaction_finalized event completes the batch and the card
  // disappears through the normal pending-batch flow.

  const autoResolveAt = currentBatch?.autoResolveAt ?? null;
  // Tick once per second while a deadline is active; the remaining
  // seconds are derived at render time (no setState-in-effect).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!autoResolveAt || isSubmitting) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [autoResolveAt, isSubmitting]);

  const autoSkipRemaining =
    autoResolveAt && !isSubmitting
      ? Math.max(0, Math.ceil((autoResolveAt - nowMs) / 1000))
      : null;

  // ============================================
  // Render
  // ============================================

  const hasData = forceVisible || pendingBatches.length > 0 || isStreaming;

  useEffect(() => {
    onHasDataChange?.(pendingBatches.length > 0);
  }, [pendingBatches.length, onHasDataChange]);

  if (!hasData) return null;

  // Streaming gap: tool call started but `args.questions` hasn't streamed in
  // far enough for a renderable batch. Show a shimmer header so the user sees
  // the agent is preparing questions instead of an empty input area.
  if (!currentBatch && !forceVisible && isStreaming) {
    return <QuestionCardLoadingShell />;
  }

  const batch = currentBatch || { questions: [], blocking: false };

  const focusCustomAfterClick = (qIdx: number) => {
    window.setTimeout(() => {
      customInputRefs.current.get(qIdx)?.focus();
    }, 50);
  };

  return (
    <QuestionCardShell
      questions={batch.questions}
      selections={selections}
      customTexts={customTexts}
      onOptionClick={handleOptionClick}
      onCustomTextChange={handleCustomTextChange}
      onCustomOptionFocus={focusCustomAfterClick}
      registerCustomInput={registerCustomInput}
      onCustomInputEnter={handleContinue}
      onSkip={handleSkip}
      onSubmit={handleContinue}
      disabled={isSubmitting}
      countdownLabel={
        autoSkipRemaining !== null
          ? t("chat.autoSkipCountdown", { seconds: autoSkipRemaining })
          : undefined
      }
      collapsed={collapsed}
      onCollapse={onCollapse}
    />
  );
};

AskQuestionCard.displayName = "AskQuestionCard";

export default AskQuestionCard;
