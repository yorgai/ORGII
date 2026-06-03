/**
 * AskQuestionCard Component
 *
 * Question card above InputArea: all questions in one scrollable column,
 * no per-question pagination. Optional batch navigation when multiple pending chunks.
 *
 * Features:
 * - Per-question single-select or multi-select with lettered badges
 * - Skip and Submit keyboard shortcuts
 *
 * Submission logic shared via useQuestionSubmission.
 * Selection state shared via useOptionSelection.
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useSettingValue } from "@src/hooks/settings/useSettings";
import { useAutoTimeout } from "@src/hooks/ui";
import { userPresenceAtom } from "@src/store/user/userPresenceAtom";
import {
  USER_PRESENCE_MODE,
  isBuiltInPresenceMode,
} from "@src/types/userPresence";
import { isCliSession } from "@src/util/session/sessionDispatch";

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

  const { pendingBatches, currentBatch, dismissBatch } = useQuestionBatches();

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
  // Auto-skip countdown
  // ============================================

  const questionAutoSkipTimeoutByPresence = useSettingValue(
    "agent.sde.questionAutoSkipTimeoutByPresence"
  );
  const userPresence = useAtomValue(userPresenceAtom);
  const activePresenceMode = isBuiltInPresenceMode(userPresence.mode)
    ? userPresence.mode
    : USER_PRESENCE_MODE.ONLINE;
  const questionAutoSkipTimeout =
    questionAutoSkipTimeoutByPresence[activePresenceMode];
  const isCliCodingSession = currentBatch
    ? isCliSession(currentBatch.sessionId)
    : false;

  const { remaining: autoSkipRemaining, cancel: cancelAutoSkip } =
    useAutoTimeout({
      timeoutSeconds: questionAutoSkipTimeout,
      enabled: isCliCodingSession && !!currentBatch && !isSubmitting,
      onTimeout: handleSkip,
    });

  // ============================================
  // Render
  // ============================================

  const hasData = forceVisible || pendingBatches.length > 0;

  useEffect(() => {
    onHasDataChange?.(pendingBatches.length > 0);
  }, [pendingBatches.length, onHasDataChange]);

  if (!hasData) return null;

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
      onSkip={() => {
        cancelAutoSkip();
        handleSkip();
      }}
      onSubmit={() => {
        cancelAutoSkip();
        handleContinue();
      }}
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
