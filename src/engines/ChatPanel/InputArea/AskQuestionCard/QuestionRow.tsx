/**
 * QuestionRow
 *
 * Shared layout for a numbered question line: "1." + text.
 * Used in QuestionCardBody (interactive card) and AskQuestionEvent / QuestionBubble (history).
 *
 * The number and text must use identical font-size and line-height so they
 * align at the first baseline.
 */
import React from "react";

import { classNames } from "@src/util/ui/classNames";

import {
  ASK_QUESTION_CARD_QUESTION,
  ASK_QUESTION_CARD_QUESTION_NUMBER,
} from "./askQuestionCardClassNames";

interface QuestionRowProps {
  number: number;
  /** Text class for the content div — e.g. ASK_QUESTION_CARD_QUESTION_TEXT or ASK_QUESTION_EVENT_QUESTION_BODY */
  textClassName: string;
  className?: string;
  children: React.ReactNode;
}

export function QuestionRow({
  number,
  textClassName,
  className,
  children,
}: QuestionRowProps) {
  return (
    <div className={classNames(ASK_QUESTION_CARD_QUESTION, className)}>
      <span className={ASK_QUESTION_CARD_QUESTION_NUMBER}>{number}.</span>
      <div className={textClassName}>{children}</div>
    </div>
  );
}

QuestionRow.displayName = "QuestionRow";
