/**
 * useOptionSelection Hook
 *
 * Manages option selection state for ask-question UI (all questions visible, scrollable).
 * Shared by AskQuestionCard (chat panel) and QuestionBubble (simulator).
 *
 * Handles:
 * - Single-select / multi-select toggle for options
 * - Custom free-text option toggling
 * - Scoped reset when scopeKey changes (e.g., batch changes in AskQuestionCard)
 */
import { useCallback, useMemo, useState } from "react";

import { CUSTOM_OPTION_INDEX } from "@src/engines/ChatPanel/InputArea/AskQuestionCard/types";

// ============================================
// Pure selection toggle
// ============================================

function computeNextSelection(
  current: Set<number>,
  optIdx: number,
  multiSelect: boolean
): Set<number> {
  const isCustom = optIdx === CUSTOM_OPTION_INDEX;

  if (isCustom) {
    const updated = new Set(current);
    if (updated.has(CUSTOM_OPTION_INDEX)) {
      updated.delete(CUSTOM_OPTION_INDEX);
    } else {
      if (!multiSelect) updated.clear();
      updated.add(CUSTOM_OPTION_INDEX);
    }
    return updated;
  }

  if (multiSelect) {
    const updated = new Set(current);
    updated.has(optIdx) ? updated.delete(optIdx) : updated.add(optIdx);
    return updated;
  }

  return new Set([optIdx]);
}

// ============================================
// Hook
// ============================================

interface UseOptionSelectionOptions {
  /** When this changes, selections auto-reset (e.g., batchId in AskQuestionCard). */
  scopeKey?: string;
}

interface SelectionInternalState {
  key: string | undefined;
  selections: Map<number, Set<number>>;
  customTexts: Map<number, string>;
}

export function useOptionSelection({ scopeKey }: UseOptionSelectionOptions) {
  const [state, setState] = useState<SelectionInternalState>({
    key: scopeKey,
    selections: new Map(),
    customTexts: new Map(),
  });

  const selections = useMemo(
    () =>
      state.key === scopeKey
        ? state.selections
        : new Map<number, Set<number>>(),
    [state, scopeKey]
  );

  const customTexts = useMemo(
    () =>
      state.key === scopeKey ? state.customTexts : new Map<number, string>(),
    [state, scopeKey]
  );

  const handleOptionClick = useCallback(
    (qIdx: number, optIdx: number, multiSelect: boolean) => {
      setState((prev) => {
        const isSameScope = prev.key === scopeKey;
        const prevSelections = isSameScope
          ? prev.selections
          : new Map<number, Set<number>>();
        const prevCustomTexts = isSameScope
          ? prev.customTexts
          : new Map<number, string>();

        const next = new Map(prevSelections);
        const current = next.get(qIdx) ?? new Set<number>();
        next.set(qIdx, computeNextSelection(current, optIdx, multiSelect));

        return {
          key: scopeKey,
          selections: next,
          customTexts: prevCustomTexts,
        };
      });
    },
    [scopeKey]
  );

  const handleCustomTextChange = useCallback(
    (qIdx: number, text: string) => {
      setState((prev) => {
        const prevCustomTexts =
          prev.key === scopeKey ? prev.customTexts : new Map<number, string>();
        const nextCustomTexts = new Map(prevCustomTexts);
        nextCustomTexts.set(qIdx, text);
        return { ...prev, key: scopeKey, customTexts: nextCustomTexts };
      });
    },
    [scopeKey]
  );

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selections: new Map(),
      customTexts: new Map(),
    }));
  }, []);

  return {
    selections,
    customTexts,
    handleOptionClick,
    handleCustomTextChange,
    reset,
  };
}
