/**
 * SubagentAdapter — renders the full SubagentBlock for delegated-agent events.
 *
 * The pre-start "assigning" phase (no `subagentSessionId` yet, status still
 * `running`) is handled at the RecipeRenderer level: the Rust tool registry
 * declares action `"assign"` with `ChatBlock::TitleOnly`, so RecipeRenderer
 * routes to TitleOnlyAdapter automatically ("Briefing subagent…"). Under
 * normal operation, by the time this adapter renders, the event has
 * `action: "delegate"` and a `subagentSessionId`.
 *
 * Terminal failures can still reach here without a session id (e.g. a
 * planner refused the prompt before spawn). In that case the underlying
 * `SubagentBlock` falls back to showing the pinned prompt + error text as
 * its expandable payload.
 */
import React from "react";

import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";

import SubagentBlock from "../../blocks/SubagentBlock";

function extractSubagentData(props: UniversalEventProps) {
  const { args, result } = props;

  const fallbackErrorMessage =
    typeof result.error_message === "string"
      ? (result.error_message as string)
      : typeof result.error === "string"
        ? (result.error as string)
        : typeof result.message === "string" && result.success === false
          ? (result.message as string)
          : undefined;

  if (props.rustExtracted?.kind === "subagent") {
    const sub = props.rustExtracted;
    return {
      description: sub.description,
      subagentType: sub.subagentType,
      resultContent: sub.resultContent,
      resultSummary: sub.resultSummary,
      subagentSessionId: sub.subagentSessionId as string | undefined,
      elapsedMs: sub.elapsedMs,
      success: sub.success,
      errorMessage: sub.errorMessage ?? fallbackErrorMessage,
      prompt:
        sub.prompt ??
        (typeof args.prompt === "string" ? args.prompt : undefined),
    };
  }

  const description =
    (args.description as string) || (args.task as string) || "";
  const subagentType =
    (args.subagent_type as string) || (args.type as string) || "";

  const resultContent =
    (result.content as string) || (result.output as string) || "";
  const resultSummary =
    typeof result.summary === "string" ? result.summary : undefined;

  const elapsedMs =
    typeof args.elapsedMs === "number" ? args.elapsedMs : undefined;

  const subagentSessionId =
    typeof args.subagentSessionId === "string"
      ? args.subagentSessionId
      : undefined;

  const prompt = typeof args.prompt === "string" ? args.prompt : undefined;

  const success =
    typeof result.success === "boolean" ? (result.success as boolean) : true;

  return {
    description,
    subagentType,
    resultContent,
    resultSummary,
    subagentSessionId,
    elapsedMs,
    success,
    errorMessage: fallbackErrorMessage,
    prompt,
  };
}

export const SubagentAdapter: React.FC<UniversalEventProps> = (props) => {
  const data = extractSubagentData(props);
  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name="agent">
      <SubagentBlock
        description={data.description}
        subagentType={data.subagentType}
        resultContent={data.resultContent}
        resultSummary={data.resultSummary}
        isLoading={
          props.status === "running" && props.showActiveEventPainting === true
        }
        defaultCollapsed={true}
        elapsedMs={data.elapsedMs}
        subagentSessionId={data.subagentSessionId}
        prompt={data.prompt}
        status={props.status}
        success={data.success}
        errorMessage={data.errorMessage}
        eventId={props.eventId}
      />
    </div>
  );
};

SubagentAdapter.displayName = "SubagentAdapter";
