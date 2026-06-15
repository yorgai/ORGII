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
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useMemo } from "react";

import { navigateToEventAtom } from "@src/engines/SessionCore/core/atoms/actions";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import {
  focusedSubagentCellAtom,
  subagentPanelRevealRequestAtom,
} from "@src/store/ui/simulatorAtom";

import SubagentBlock from "../../blocks/SubagentBlock";

const EMPTY_SUBAGENT_SESSION_ID = "__no-subagent-session__";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = nonEmptyString(value);
    if (text) return text;
  }
  return undefined;
}

function extractPromptFromChildEvents(
  events: readonly SessionEvent[]
): string | undefined {
  for (const event of events) {
    if (event.source !== "user") continue;
    const text = nonEmptyString(event.displayText);
    if (text) return text;
  }
  return undefined;
}

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
      prompt: firstNonEmptyString(
        sub.prompt,
        args.prompt,
        args.instructions,
        args.task,
        result.prompt
      ),
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

  const prompt = firstNonEmptyString(
    args.prompt,
    args.instructions,
    args.task,
    result.prompt
  );

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
  const childEvents = useAtomValue(
    chatEventsForSessionAtomFamily(
      data.subagentSessionId ?? EMPTY_SUBAGENT_SESSION_ID
    )
  );
  const childPrompt = useMemo(
    () => extractPromptFromChildEvents(childEvents),
    [childEvents]
  );
  const prompt = data.prompt ?? childPrompt;

  const setFocusedCell = useSetAtom(focusedSubagentCellAtom);
  const setPanelReveal = useSetAtom(subagentPanelRevealRequestAtom);
  const navigateToEvent = useSetAtom(navigateToEventAtom);
  const handleNavigate = useCallback(() => {
    if (!data.subagentSessionId) return;
    // Seek the main replay cursor back to this subagent's delegate event so
    // the cursor lands inside the subagent's [startedAtMs, endedAtMs] clip
    // window. Without this, a subagent that already finished has retired its
    // monitor cell (the cursor sits past endedAtMs), so focusing the cell or
    // bumping the reveal counter has nothing to act on. navigateToEventAtom
    // also flips replayMode to "replay" (free-browse), pausing tail-follow at
    // that moment. The cell then re-materialises and focus/reveal take effect.
    navigateToEvent(props.eventId);
    setFocusedCell(data.subagentSessionId);
    setPanelReveal((prev) => prev + 1);
  }, [
    data.subagentSessionId,
    props.eventId,
    navigateToEvent,
    setFocusedCell,
    setPanelReveal,
  ]);

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
        prompt={prompt}
        status={props.status}
        success={data.success}
        errorMessage={data.errorMessage}
        eventId={props.eventId}
        onNavigate={data.subagentSessionId ? handleNavigate : undefined}
      />
    </div>
  );
};

SubagentAdapter.displayName = "SubagentAdapter";
