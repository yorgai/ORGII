/**
 * Canonical set of tool function names recognised as ask-user-questions.
 * One shared source of truth for `extractQuestionBatch`, `isAskQuestionEvent`
 * (utils.ts), and any future aliasing layer.
 *
 * All comparisons MUST use `.toLowerCase()` — LLMs may emit any casing
 * depending on their system prompt and model family.
 */
export const ASK_QUESTION_FUNCTIONS = new Set([
  "ask_user_questions",
  "ask_question",
  "askuserquestion",
  "askquestion",
  "collectfeedback",
  "question",
  "ask_followup_question",
]);
