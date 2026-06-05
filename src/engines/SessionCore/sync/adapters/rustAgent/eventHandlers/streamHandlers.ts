/**
 * Stream Handlers
 *
 * Handlers for message, thinking, and tool call delta events.
 * Also handles agent:streaming_complete from Rust StreamingBuffer.
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  makeAssistantEvent,
  makeThinkingEvent,
  makeToolCallEvent,
} from "../../shared/eventBuilders";
import { mergeStreamingText } from "../../shared/streamTextAccumulator";
import {
  buildToolArgsFromParsed,
  extractThinkContent,
  parsePartialToolArgs,
} from "../../shared/streamingParsers";
import { capStreamContent } from "../../shared/subagentTracking";
import type { AgentWSEvent, StreamRefs } from "../../shared/types";
import {
  clearMessageStreamRefs,
  clearStreamingInfo,
  clearThinkingStreamRefs,
  getToolCallId,
  getToolName,
  updateStreamingInfo,
} from "./streamHelpers";
import type { EventHandlerContext } from "./types";

function toolCallDeltaMessageId(toolCallId: string): string {
  return `tool-call-${toolCallId}`;
}

function appendLiveStreamDelta(
  refs: StreamRefs,
  delta: string,
  idPrefix: string,
  sessionId: string
): void {
  if (!refs.idRef.current) {
    refs.idRef.current = `${idPrefix}-${sessionId}-${Date.now()}`;
  }
  refs.contentRef.current = capStreamContent(
    mergeStreamingText(refs.contentRef.current, delta)
  );
}

export function handleMessageDelta(
  event: AgentWSEvent,
  sessionId: string,
  ctx: EventHandlerContext
): void {
  const delta = event.content || "";
  ctx.setStreaming(true);

  if (!delta) return;

  if (!ctx.assistantStreamRef || !ctx.thinkingStreamRef) {
    console.warn(
      "[streamHandlers] handleMessageDelta: StreamRefs missing, dropping delta"
    );
    return;
  }

  appendLiveStreamDelta(
    ctx.assistantStreamRef.current,
    delta,
    "stream-msg-live",
    sessionId
  );

  const streamRefs = ctx.assistantStreamRef.current;
  const rawAccumulated = streamRefs.contentRef.current;
  const inlineThinking = extractThinkContent(rawAccumulated);
  if (inlineThinking && ctx.inlineThinkingIdRef) {
    ctx.inlineThinkingIdRef.current ||= `thinking-inline-${Date.now()}`;
  }

  if (streamRefs.idRef.current) {
    eventStoreProxy.upsert(
      makeAssistantEvent(
        streamRefs.idRef.current,
        sessionId,
        rawAccumulated,
        true
      ),
      sessionId
    );
  }

  updateStreamingInfo(ctx, true, false, rawAccumulated);
}

export function handleThinkingDelta(
  event: AgentWSEvent,
  sessionId: string,
  ctx: EventHandlerContext
): void {
  const delta = event.content || "";
  ctx.setStreaming(true);

  if (!ctx.thinkingStreamRef) {
    console.warn(
      "[streamHandlers] handleThinkingDelta: thinkingStreamRef missing, dropping delta"
    );
    return;
  }

  appendLiveStreamDelta(
    ctx.thinkingStreamRef.current,
    delta,
    "stream-think-live",
    sessionId
  );
  const streamRefs = ctx.thinkingStreamRef.current;
  const accumulated = streamRefs.contentRef.current;
  updateStreamingInfo(ctx, true, true, accumulated);

  if (streamRefs.idRef.current) {
    eventStoreProxy.upsert(
      makeThinkingEvent(streamRefs.idRef.current, sessionId, accumulated, true),
      sessionId
    );
  }
}

/**
 * Accumulate a streamed tool_call fragment.
 *
 * Buffer-then-upsert, keyed on the wire `tool_call_id`:
 *
 * 1. Each `index` (the OpenAI / Anthropic streaming position) gets one
 *    in-memory buffer. Fragments accumulate there — no store event is
 *    written until we have the real `tool_call_id` from the provider.
 * 2. The first delta that carries an id promotes the buffer: `messageId`
 *    becomes `tool-call-${toolCallId}` and we upsert. Every subsequent
 *    delta for the same index re-upserts using the same stable id.
 * 3. Once `buffer.toolCallId` is set, later deltas that carry a DIFFERENT
 *    id are rejected with a warning (wire-schema corruption — do not let
 *    the identity drift and create two store rows).
 *
 * Why buffer-then-upsert: `merge_events` (Rust) pairs tool_call ↔
 * tool_result strictly by `callId`. The old path synthesized
 * `pending-tc-${index}` ids, upserted an event under that fake id, and
 * then upserted again under the real id when it landed — leaving a
 * zombie event in the store with no matching result, which broke the
 * `create_plan` → Build-button wiring. The only safe policy is: do not
 * publish an event until its identity is final.
 *
 * The cost is that the UI card for a tool call appears one delta later
 * in the very rare case the provider withholds `tool_call_id` on the
 * first delta. In practice OpenAI/Anthropic always emit `id` on the
 * first delta for a given `index`, so this is a no-op for the common
 * path and a correctness fix for the pathological one.
 */
export function handleToolCallDelta(
  event: AgentWSEvent,
  sessionId: string,
  ctx: EventHandlerContext
): void {
  if (!ctx.features.hasToolCallDelta || !ctx.toolCallDeltaBuffersRef) return;

  const deltaIndex = event.index ?? 0;
  const argsDelta = event.argumentsDelta ?? "";
  const incomingId = getToolCallId(event);

  let buffer = ctx.toolCallDeltaBuffersRef.current.get(deltaIndex);
  const isNewBuffer = !buffer;
  if (!buffer) {
    buffer = {
      toolCallId: incomingId || undefined,
      toolName: getToolName(event),
      argsJson: "",
      messageId: incomingId ? toolCallDeltaMessageId(incomingId) : null,
    };
    ctx.toolCallDeltaBuffersRef.current.set(deltaIndex, buffer);

    clearMessageStreamRefs(ctx);
    clearThinkingStreamRefs(ctx);
    clearStreamingInfo(ctx);
    ctx.setStreaming(true);
  }

  if (incomingId) {
    if (!buffer.toolCallId) {
      buffer.toolCallId = incomingId;
      buffer.messageId = toolCallDeltaMessageId(incomingId);
    } else if (buffer.toolCallId !== incomingId) {
      console.warn(
        "[streamHandlers] tool_call_id drift within delta stream — ignoring",
        {
          index: deltaIndex,
          existingId: buffer.toolCallId,
          incomingId,
          sessionId,
        }
      );
      return;
    }
  } else if (isNewBuffer) {
    console.warn(
      "[streamHandlers] tool_call delta arrived without tool_call_id — buffering until id lands",
      { index: deltaIndex, sessionId }
    );
  }

  const toolName = getToolName(event);
  if (toolName !== "unknown") {
    buffer.toolName = toolName;
    if (buffer.toolCallId) {
      buffer.messageId = toolCallDeltaMessageId(buffer.toolCallId);
    }
  }
  buffer.argsJson += argsDelta;

  if (!buffer.toolCallId || !buffer.messageId) {
    return;
  }

  const parsed = parsePartialToolArgs(buffer.argsJson);
  const toolArgs = buildToolArgsFromParsed(parsed);

  const toolCallEvent = makeToolCallEvent(
    buffer.messageId,
    sessionId,
    buffer.toolName,
    buffer.toolCallId,
    toolArgs,
    true
  );
  eventStoreProxy.upsert(toolCallEvent, sessionId);
}

/**
 * Handle agent:streaming_complete from Rust StreamingBuffer.
 *
 * Rust Agent already pushed the authoritative completed stream event into the
 * backend EventStore before broadcasting this notification. The frontend must
 * not upsert/replace that event again; it only clears transient live-stream
 * refs so current-turn UI stops showing stale partial text.
 */
export async function handleStreamingComplete(
  event: AgentWSEvent,
  _sessionId: string,
  ctx: EventHandlerContext
): Promise<void> {
  const streamType = event.streamType as "message" | "thinking" | undefined;
  const completeEvent = event.event;

  if (!completeEvent) {
    console.warn("[streamHandlers] streaming_complete missing event payload");
    return;
  }

  if (streamType === "message") {
    const liveMessageId = ctx.assistantStreamRef?.current.idRef.current || null;
    if (liveMessageId) {
      await eventStoreProxy.replaceAndRemove(
        liveMessageId,
        completeEvent as SessionEvent,
        (completeEvent as SessionEvent).sessionId
      );
    }
    clearMessageStreamRefs(ctx);
    ctx.setStreaming(false);
    ctx.onStatusChangeRef.current?.("completed");
    if (ctx.streamingCompleteHandledRef) {
      ctx.streamingCompleteHandledRef.current = true;
    }
    return;
  }

  if (streamType === "thinking") {
    const liveThinkingId = ctx.thinkingStreamRef?.current.idRef.current || null;
    if (liveThinkingId) {
      await eventStoreProxy.replaceAndRemove(
        liveThinkingId,
        completeEvent as SessionEvent,
        (completeEvent as SessionEvent).sessionId
      );
    }
    clearThinkingStreamRefs(ctx);
    return;
  }

  console.warn("[streamHandlers] unknown streaming_complete stream type", {
    streamType,
  });
}
