/**
 * Shared content chrome for ask_user history cards (ThinkingEvent-style left rule).
 */
import React from "react";

import {
  ASK_QUESTION_EVENT_CONTENT_INNER,
  ASK_QUESTION_EVENT_CONTENT_LINE,
} from "@src/engines/ChatPanel/InputArea/AskQuestionCard/askQuestionCardClassNames";
import { getEventBlockContentClasses } from "@src/engines/ChatPanel/blocks/primitives";

export function AskQuestionHistoryBody({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={getEventBlockContentClasses({ padding: "p-0" })}>
      <div className={ASK_QUESTION_EVENT_CONTENT_LINE}>
        <div
          className={`${ASK_QUESTION_EVENT_CONTENT_INNER} ${getEventBlockContentClasses({ padding: "p-0" })}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

AskQuestionHistoryBody.displayName = "AskQuestionHistoryBody";
