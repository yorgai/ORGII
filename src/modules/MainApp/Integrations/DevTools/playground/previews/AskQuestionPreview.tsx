/**
 * AskQuestionPreview
 *
 * DevTools playground preview of the interactive question card.
 * Uses QuestionCardShell for the full card chrome (header + body + footer).
 * Local state stubs out the live session hooks that the real card depends on.
 */
import { useCallback, useRef, useState } from "react";

import { QuestionCardShell } from "@src/engines/ChatPanel/InputArea/AskQuestionCard/QuestionCardShell";
import {
  CUSTOM_OPTION_INDEX,
  type SingleQuestion,
} from "@src/engines/ChatPanel/InputArea/AskQuestionCard/types";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

// ============================================
// Extract questions from SessionEvent
// ============================================

function extractPreviewQuestions(event: SessionEvent): SingleQuestion[] {
  const args = event.args;
  if (!args || Object.keys(args).length === 0) return [];

  const structured = args.questions as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(structured) || structured.length === 0) return [];

  return structured.map((sq) => {
    const text =
      (sq.question as string) ||
      (sq.prompt as string) ||
      (sq.header as string) ||
      (sq.title as string) ||
      (sq.text as string) ||
      (sq.content as string) ||
      "";

    const multiSelect =
      (sq.multiSelect as boolean) || (sq.allow_multiple as boolean) || false;

    const rawOpts = sq.options as
      | Array<Record<string, unknown> | string>
      | undefined;
    const options: SingleQuestion["options"] = [];
    if (Array.isArray(rawOpts)) {
      for (let idx = 0; idx < rawOpts.length; idx++) {
        const opt = rawOpts[idx];
        if (typeof opt === "string") {
          options.push({ id: `opt_${idx}`, label: opt });
        } else if (opt && typeof opt === "object") {
          options.push({
            id: (opt.id as string) || `opt_${idx}`,
            label: (opt.label as string) || "",
            description: (opt.description as string) || undefined,
          });
        }
      }
    }

    return { text, options, multiSelect };
  });
}

// ============================================
// Component
// ============================================

interface AskQuestionPreviewProps {
  event: SessionEvent;
  collapsed?: boolean;
  onCollapse?: () => void;
}

export function AskQuestionPreview({
  event,
  collapsed,
  onCollapse,
}: AskQuestionPreviewProps) {
  const questions = extractPreviewQuestions(event);

  const [selections, setSelections] = useState<Map<number, Set<number>>>(
    () => new Map()
  );
  const [customTexts, setCustomTexts] = useState<Map<number, string>>(
    () => new Map()
  );
  const customInputRefs = useRef<Map<number, HTMLTextAreaElement | null>>(
    new Map()
  );

  const registerCustomInput =
    (qIdx: number) => (el: HTMLTextAreaElement | null) => {
      if (el) customInputRefs.current.set(qIdx, el);
      else customInputRefs.current.delete(qIdx);
    };

  const handleOptionClick = useCallback(
    (qIdx: number, optIdx: number, multiSelect: boolean) => {
      setSelections((prev) => {
        const next = new Map(prev);
        const current = new Set(next.get(qIdx) ?? []);

        if (optIdx === CUSTOM_OPTION_INDEX) {
          if (current.has(CUSTOM_OPTION_INDEX)) {
            current.delete(CUSTOM_OPTION_INDEX);
          } else {
            if (!multiSelect) current.clear();
            current.add(CUSTOM_OPTION_INDEX);
          }
        } else if (multiSelect) {
          if (current.has(optIdx)) {
            current.delete(optIdx);
          } else {
            current.add(optIdx);
          }
        } else {
          if (current.has(optIdx) && current.size === 1) {
            current.clear();
          } else {
            current.clear();
            current.add(optIdx);
          }
        }

        next.set(qIdx, current);
        return next;
      });
    },
    []
  );

  const handleCustomTextChange = useCallback((qIdx: number, value: string) => {
    setCustomTexts((prev) => {
      const next = new Map(prev);
      next.set(qIdx, value);
      return next;
    });
  }, []);

  const focusCustomAfterClick = (qIdx: number) => {
    window.setTimeout(() => {
      customInputRefs.current.get(qIdx)?.focus();
    }, 50);
  };

  if (questions.length === 0) return null;

  return (
    <QuestionCardShell
      questions={questions}
      selections={selections}
      customTexts={customTexts}
      onOptionClick={handleOptionClick}
      onCustomTextChange={handleCustomTextChange}
      onCustomOptionFocus={focusCustomAfterClick}
      registerCustomInput={registerCustomInput}
      collapsed={collapsed}
      onCollapse={onCollapse}
    />
  );
}

AskQuestionPreview.displayName = "AskQuestionPreview";
