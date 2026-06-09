/**
 * AskQuestionEvent - Universal Component
 *
 * Renders agent clarification questions in the chat history.
 *
 * Two states:
 * - Pending: Interactive question with options (rarely shown here since
 *   AskQuestionCard above the input handles active questions)
 * - Answered: "Answers" card showing question + selected answer
 *
 * @example
 * <AskQuestionEvent event={event} />
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getEventIcon } from "@src/config/toolIcons";
import { QuestionRow } from "@src/engines/ChatPanel/InputArea/AskQuestionCard/QuestionRow";
import {
  ASK_QUESTION_EVENT_ANSWER_TEXT,
  ASK_QUESTION_EVENT_QUESTION_BODY,
} from "@src/engines/ChatPanel/InputArea/AskQuestionCard/askQuestionCardClassNames";
import {
  EventBlockHeader,
  EventBlockHeaderIcon,
  EventBlockHeaderTitle,
  getEventBlockContainerClasses,
} from "@src/engines/ChatPanel/blocks/primitives";
import { useBlockHeader } from "@src/engines/ChatPanel/blocks/useBlockLocate";
import {
  type RawEventInput,
  useNormalizedEventProps,
} from "@src/engines/SessionCore/rendering/props";
import {
  useLifecycleLabels,
  useToolLabelText,
} from "@src/engines/SessionCore/rendering/registry";
import type { EventVariant } from "@src/engines/SessionCore/rendering/types/universalProps";

import { AskQuestionHistoryBody } from "./AskQuestionHistoryChrome";

// ============================================
// Types
// ============================================

export interface AskQuestionEventProps extends RawEventInput {
  variant?: EventVariant;
}

interface StructuredQuestionOption {
  label: string;
  description?: string;
  id?: string;
}

interface StructuredQuestion {
  question?: string;
  prompt?: string;
  header?: string;
  title?: string;
  text?: string;
  content?: string;
  options?: StructuredQuestionOption[];
  multiSelect?: boolean;
  allow_multiple?: boolean;
  id?: string;
}

interface AnsweredPair {
  question: string;
  answers: string[];
}

// ============================================
// Extract answered data from event
// ============================================

function extractAnsweredData(props: RawEventInput): {
  pairs: AnsweredPair[];
  isAnswered: boolean;
} {
  const event = props.event;
  const result = (event?.result || props.result) as
    | Record<string, unknown>
    | undefined;
  const args = (event?.args || props.args) as
    | Record<string, unknown>
    | undefined;

  // "answered" requires an explicit signal from the backend: either the
  // result status field is set to "answered"/"responsed", or the agent
  // actually wrote answer payloads. eventStatus === "completed" alone is
  // NOT sufficient — the event completes whenever the tool call finishes,
  // including when the agent proceeds without a user response.
  const hasAnswerPayload =
    (Array.isArray(result?.answers) &&
      (result.answers as unknown[]).length > 0) ||
    (typeof result?.answer === "string" && result.answer.length > 0);

  const isAnswered =
    result?.status === "answered" ||
    result?.status === "responsed" ||
    hasAnswerPayload;

  // Try to extract structured questions from args
  const structuredQuestions = args?.questions as
    | StructuredQuestion[]
    | undefined;

  // Answers live on `result.answers` — written authoritatively by Rust
  // `QuestionManager::respond` via `agent:interaction_finalized`. The
  // object-merge in `merge_events` keeps the field across subsequent
  // `agent:tool_result` events.
  const resultAnswers = result?.answers as string[][] | undefined;
  const resultAnswer = result?.answer as string | undefined;

  if (Array.isArray(structuredQuestions) && structuredQuestions.length > 0) {
    const topLevelText =
      (args?.title as string) || (args?.prompt as string) || "";

    const pairs: AnsweredPair[] = structuredQuestions.map((sq, idx) => {
      const questionText =
        sq.question ||
        sq.prompt ||
        sq.header ||
        sq.title ||
        sq.text ||
        sq.content ||
        "";

      let answers: string[] = [];
      if (Array.isArray(resultAnswers) && resultAnswers[idx]) {
        answers = resultAnswers[idx];
      } else if (idx === 0 && resultAnswer) {
        answers = [resultAnswer];
      }

      return {
        question: questionText || (idx === 0 ? topLevelText : ""),
        answers,
      };
    });

    return { pairs, isAnswered };
  }

  // Legacy single question format
  const questionData = result?.question as Record<string, unknown> | undefined;
  const question =
    (questionData?.question as string) ||
    (typeof result?.question === "string" ? result.question : "") ||
    (result?.content as string) ||
    "";

  const answer = resultAnswer || (questionData?.answer as string) || "";

  if (!question) return { pairs: [], isAnswered };

  return {
    pairs: [{ question, answers: answer ? [answer] : [] }],
    isAnswered,
  };
}

// ============================================
// QuestionHistoryBlock — unified answered / pending / failed display
// ============================================

type QuestionDisplayStatus = "answered" | "pending" | "failed";

function resolveDisplayStatus(
  rawStatus: string | undefined,
  isAnswered: boolean
): QuestionDisplayStatus {
  if (isAnswered) return "answered";
  // Tool call completed without a user reply — agent proceeded on its own.
  // Show "skipped" (static terminal state), not a loading spinner.
  if (rawStatus === "completed") return "failed";
  if (rawStatus === "failed") return "failed";
  // `awaiting_user` means the question is still live and waiting for the
  // user. AskQuestionCard above the input handles the interactive state.
  // Show "pending" here so the history block acts as a status indicator
  // rather than prematurely rendering "Questions skipped" before the
  // agent:interaction_finalized event arrives to flip it to "answered".
  if (rawStatus === "awaiting_user") return "pending";
  return "pending";
}

const STATUS_ICON: Record<QuestionDisplayStatus, React.ReactNode> = {
  answered: getEventIcon("ask_user_questions", {
    status: "answered",
    className: "text-success-6",
  }),
  pending: getEventIcon("ask_user_questions", { className: "text-primary-6" }),
  failed: getEventIcon("ask_user_questions", { className: "text-primary-6" }),
};

function useQuestionStatusTitle(status: QuestionDisplayStatus): string {
  const { t } = useTranslation("sessions");
  const lifecycle = useLifecycleLabels("ask_user_questions");
  const answered = useToolLabelText("ask_user_questions", "answered");
  if (status === "answered") return answered;
  if (status === "failed") return t("tools.askUserQuestionsSkipped");
  return lifecycle.running;
}

const QuestionHistoryBlock: React.FC<{
  pairs: AnsweredPair[];
  status: QuestionDisplayStatus;
  eventId?: string;
  variant?: EventVariant;
  showActiveEventPainting: boolean;
}> = ({ pairs, status, eventId, variant, showActiveEventPainting }) => {
  const { t } = useTranslation("sessions");
  const titleText = useQuestionStatusTitle(status);
  const isSimulator = variant === "simulator";
  const locateEventId =
    status === "answered" && !isSimulator ? eventId : undefined;
  // Simulator surfaces the answered card in its own "Interactions" tab where
  // the user already navigated here to inspect the answer — collapsing it
  // by default forces an extra click on every row. Chat keeps the collapse
  // behaviour so answered cards don't clutter the scroll-back timeline.
  const defaultCollapsed = !isSimulator && status === "answered";
  const {
    isCollapsed,
    isHeaderHovered,
    handleHeaderClick,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
    handleLocate,
  } = useBlockHeader({
    defaultCollapsed,
    eventId: locateEventId,
    collapseAllValue: true,
  });

  // In simulator mode the header acts as a static status row — body is
  // always rendered so users never have to expand to see their own answer.
  const collapsed = isSimulator ? false : isCollapsed;
  const hasBody = status === "answered" || status === "failed";

  return (
    <div
      className={getEventBlockContainerClasses(false)}
      data-tool-call-event-id={eventId}
      data-tool-call-name="ask_user_questions"
    >
      <EventBlockHeader
        isCollapsed={collapsed}
        withHover={false}
        onClick={locateEventId ? handleLocate : undefined}
        onNavigate={locateEventId ? handleLocate : undefined}
        onMouseEnter={handleHeaderMouseEnter}
        onMouseLeave={handleHeaderMouseLeave}
      >
        <EventBlockHeaderIcon
          icon={STATUS_ICON[status]}
          isCollapsed={collapsed}
          isHeaderHovered={isHeaderHovered}
          onToggle={isSimulator ? undefined : handleHeaderClick}
          hasContent={hasBody && !isSimulator}
          revealChevronOnIconHoverOnly={Boolean(locateEventId)}
        />
        <EventBlockHeaderTitle
          isLoading={status === "pending" && showActiveEventPainting}
        >
          {titleText}
        </EventBlockHeaderTitle>
      </EventBlockHeader>

      {hasBody && !collapsed && (
        <AskQuestionHistoryBody>
          <div className="flex flex-col gap-4">
            {pairs.map((pair, idx) => {
              if (!pair.question.trim()) return null;
              return (
                <div key={idx} className="flex flex-col gap-1.5">
                  <QuestionRow
                    number={idx + 1}
                    textClassName={ASK_QUESTION_EVENT_QUESTION_BODY}
                  >
                    {pair.question}
                  </QuestionRow>
                  {status === "answered" && pair.answers.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {pair.answers.map((answer, aidx) => (
                        <div
                          key={aidx}
                          className={ASK_QUESTION_EVENT_ANSWER_TEXT}
                        >
                          {answer}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {status === "answered" && pair.answers.length === 0 ? (
                    <div className="chat-block-title italic text-text-3">
                      {t("chat.noAnswerProvided")}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </AskQuestionHistoryBody>
      )}
    </div>
  );
};

// ============================================
// Streaming placeholder — shown while `args.questions` hasn't streamed in yet
// ============================================

const QuestionStreamingPlaceholder: React.FC<{ eventId?: string }> = ({
  eventId,
}) => {
  const lifecycle = useLifecycleLabels("ask_user_questions");
  return (
    <div
      className={getEventBlockContainerClasses(false)}
      data-tool-call-event-id={eventId}
      data-tool-call-name="ask_user_questions"
    >
      <EventBlockHeader isCollapsed withHover={false}>
        <EventBlockHeaderIcon
          icon={STATUS_ICON.pending}
          isCollapsed
          isHeaderHovered={false}
          hasContent={false}
        />
        <EventBlockHeaderTitle isLoading>
          {lifecycle.running}
        </EventBlockHeaderTitle>
      </EventBlockHeader>
    </div>
  );
};

// ============================================
// Main Component
// ============================================

export const AskQuestionEvent: React.FC<AskQuestionEventProps> = (props) => {
  const normalizedProps = useNormalizedEventProps(props, "ask_user_questions");

  const { pairs, isAnswered } = useMemo(
    () => extractAnsweredData(props),
    [props]
  );

  const rawStatus = props.event?.displayStatus as string | undefined;

  const eventId =
    props.event?.id ||
    props.event_id ||
    ((props as Record<string, unknown>).id as string | undefined);

  if (!normalizedProps) return null;

  const showActiveEventPainting =
    normalizedProps.showActiveEventPainting ?? false;
  const isStreaming =
    rawStatus !== "completed" &&
    rawStatus !== "failed" &&
    showActiveEventPainting;

  if (pairs.length === 0) {
    if (isStreaming) {
      return <QuestionStreamingPlaceholder eventId={eventId} />;
    }
    return null;
  }

  const status = resolveDisplayStatus(rawStatus, isAnswered);

  return (
    <QuestionHistoryBlock
      pairs={pairs}
      status={status}
      eventId={eventId}
      variant={props.variant}
      showActiveEventPainting={showActiveEventPainting}
    />
  );
};

AskQuestionEvent.displayName = "AskQuestionEvent";

export default AskQuestionEvent;
