/**
 * extractQuestionBatch
 *
 * Parses a SessionEvent into a QuestionBatch if it represents a pending
 * question (either structured AskQuestion tool call or legacy ask_user).
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { QuestionBatch, QuestionOption, SingleQuestion } from "./types";

const ASK_QUESTION_FUNCTIONS = new Set([
  "askuserquestion",
  "AskUserQuestion",
  "AskQuestion",
  "CollectFeedback",
  "question",
  "ask_user_questions",
  "ask_question",
  "ask_followup_question",
]);

/**
 * Predicate shared by `extractQuestionBatch` and `useQuestionBatches`'s
 * streaming-detection pass. Returns true for the activity event AND any
 * `tool_call` event whose `functionName` matches one of the recognized
 * ask-question aliases — same set the parser walks below.
 */
export function isAskUserQuestionsEvent(event: SessionEvent): boolean {
  if (event.actionType === "ask_user_questions") return true;
  if (
    event.actionType === "tool_call" &&
    ASK_QUESTION_FUNCTIONS.has(event.functionName)
  ) {
    return true;
  }
  return false;
}

export function extractQuestionBatch(
  event: SessionEvent
): QuestionBatch | null {
  const isAskUserActivity = event.actionType === "ask_user_questions";

  const isAskQuestionToolCall =
    event.actionType === "tool_call" &&
    ASK_QUESTION_FUNCTIONS.has(event.functionName);

  if (!isAskUserActivity && !isAskQuestionToolCall) return null;

  const result = event.result as Record<string, unknown> | undefined;
  const args = event.args as Record<string, unknown> | undefined;

  if (isAskQuestionToolCall || isAskUserActivity) {
    if (result?.success === true) return null;
    if (result?.error) return null;
  }
  if (event.displayStatus === "completed") return null;

  const sessionId = event.sessionId || "";
  const questionId =
    (result?.call_id as string) || event.callId || event.id || "";

  // Format A: structured questions array (askuserquestion / AskQuestion / question tool)
  const structuredQuestions = args?.questions as
    | Array<Record<string, unknown>>
    | undefined;
  if (
    (isAskQuestionToolCall || isAskUserActivity) &&
    Array.isArray(structuredQuestions) &&
    structuredQuestions.length > 0
  ) {
    const topLevelText =
      (args?.title as string) || (args?.prompt as string) || "";

    const questions: SingleQuestion[] = structuredQuestions.map((sq) => {
      const questionText =
        (sq.question as string) ||
        (sq.prompt as string) ||
        (sq.header as string) ||
        (sq.title as string) ||
        (sq.text as string) ||
        (sq.content as string) ||
        "";
      const multiSelect =
        (sq.multiSelect as boolean) ||
        (sq.multiple as boolean) ||
        (sq.allow_multiple as boolean) ||
        false;

      const rawOpts = sq.options as
        | Array<Record<string, unknown> | string>
        | undefined;
      const options: QuestionOption[] = [];
      if (Array.isArray(rawOpts)) {
        for (let optIdx = 0; optIdx < rawOpts.length; optIdx++) {
          const opt = rawOpts[optIdx];
          if (typeof opt === "string") {
            options.push({ id: `opt_${optIdx}`, label: opt });
          } else if (opt && typeof opt === "object") {
            const label = (opt.label as string) || "";
            options.push({
              id: (opt.id as string) || `opt_${optIdx}`,
              label,
              description: (opt.description as string) || undefined,
            });
          }
        }
      }

      return { text: questionText, options, multiSelect };
    });

    if (questions.every((q) => !q.text)) {
      if (topLevelText && questions.length === 1) {
        questions[0] = { ...questions[0], text: topLevelText };
      } else {
        return null;
      }
    }

    return {
      chunkId: event.id || "",
      sessionId,
      questionId,
      questions,
      blocking: true,
    };
  }

  // Format B: Legacy / OS Agent ask_user (single question)
  const resultStatus = result?.status as string | undefined;
  const questionData = result?.question as Record<string, unknown> | undefined;
  const nestedStatus = questionData?.status as string | undefined;

  const isPending =
    resultStatus === "waiting_for_answer" ||
    resultStatus === "QUESTION_ASKED" ||
    nestedStatus === "waiting_for_answer" ||
    nestedStatus === "QUESTION_ASKED" ||
    resultStatus === "running" ||
    event.activityStatus === "pending";

  if (!isPending) return null;

  let question = "";
  let options: string[] = [];
  let blocking = true;

  if (questionData && typeof questionData === "object") {
    question = (questionData.question as string) || "";
    options = (questionData.options as string[]) || [];
    blocking = questionData.blocking !== false;
  } else if (result) {
    question =
      (typeof result.question === "string" ? result.question : "") ||
      (result.content as string) ||
      "";
    options = (result.options as string[]) || [];
  }

  if (!question && args) {
    question = (args.question as string) || (args.content as string) || "";
  }

  if (!question) return null;

  return {
    chunkId: event.id || "",
    sessionId,
    questionId: questionId || event.id || "",
    questions: [
      {
        text: question,
        options: options.map((opt, idx) => ({
          id: `opt_${idx}`,
          label: opt,
        })),
        multiSelect: false,
      },
    ],
    blocking,
  };
}
