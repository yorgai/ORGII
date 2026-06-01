/**
 * Stream Finalization Helpers
 *
 * Helper functions for finalizing streaming content and common event accessors.
 */
import { resetStreamRefs } from "../../shared/eventBuilders";
import type { AgentWSEvent } from "../../shared/types";
import type { EventHandlerContext } from "./types";

/**
 * Reset all streaming state in context.
 * Used by handleComplete and handleError to avoid code duplication.
 */
export function resetAllStreamingState(ctx: EventHandlerContext): void {
  if (ctx.assistantStreamRef) resetStreamRefs(ctx.assistantStreamRef.current);
  if (ctx.thinkingStreamRef) resetStreamRefs(ctx.thinkingStreamRef.current);
  if (ctx.inlineThinkingIdRef) ctx.inlineThinkingIdRef.current = "";
  ctx.execOutputBufferRef.current = "";
  if (ctx.toolCallDeltaBuffersRef) ctx.toolCallDeltaBuffersRef.current.clear();
  clearStreamingInfo(ctx);
  if (ctx.streamingCompleteHandledRef) {
    ctx.streamingCompleteHandledRef.current = false;
  }
}

export function getToolCallId(event: AgentWSEvent): string | undefined {
  return event.toolCallId;
}

export function getToolName(event: AgentWSEvent): string {
  return event.tool || event.toolName || "unknown";
}

export function getEventSessionId(event: AgentWSEvent): string | undefined {
  return event.sessionId;
}

/**
 * Clear streamingInfoRef to idle state.
 */
export function clearStreamingInfo(ctx: EventHandlerContext): void {
  if (ctx.streamingInfoRef) {
    ctx.streamingInfoRef.current = {
      isStreaming: false,
      isThinking: false,
      content: "",
    };
    ctx.onStreamingDeltaRef?.current?.(ctx.streamingInfoRef.current);
  }
}

/**
 * Clear message streaming refs.
 */
export function clearMessageStreamRefs(ctx: EventHandlerContext): void {
  if (ctx.assistantStreamRef) {
    ctx.assistantStreamRef.current.contentRef.current = "";
    ctx.assistantStreamRef.current.idRef.current = "";
  }
  clearStreamingInfo(ctx);
}

/**
 * Clear thinking streaming refs.
 */
export function clearThinkingStreamRefs(ctx: EventHandlerContext): void {
  if (ctx.thinkingStreamRef) {
    ctx.thinkingStreamRef.current.contentRef.current = "";
    ctx.thinkingStreamRef.current.idRef.current = "";
  }
  if (ctx.inlineThinkingIdRef) ctx.inlineThinkingIdRef.current = "";
  clearStreamingInfo(ctx);
}

/**
 * Update streamingInfoRef with current streaming state.
 */
export function updateStreamingInfo(
  ctx: EventHandlerContext,
  isStreaming: boolean,
  isThinking: boolean,
  content: string
): void {
  if (ctx.streamingInfoRef) {
    ctx.streamingInfoRef.current = { isStreaming, isThinking, content };
    ctx.onStreamingDeltaRef?.current?.(ctx.streamingInfoRef.current);
  }
}
