/**
 * Chat Item Pipeline — Deduplication
 *
 * Two dedup passes:
 *
 * 1. **Running tool_call dedup** — identifies "running" tool_call chunks that
 *    have a matching completed/failed counterpart later in the history.
 *    Also builds a call_id -> args map so result events (which often have
 *    empty args) can inherit the args from their running counterpart.
 *
 * 2. **Assistant message content dedup** — removes consecutive assistant
 *    messages with identical text. This handles the race between
 *    `agent:streaming_complete` (replaceAndRemove) and `agent:complete`
 *    (upsert) where two events with different IDs but the same content
 *    can briefly coexist in the EventStore.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export interface DedupResult {
  /** Chunk IDs of transient tool-call rows that should be skipped once a result row exists */
  runningChunksToSkip: Set<string>;
  /** call_id -> args from running/call events, for merging into result events */
  runningArgsMap: Map<string, Record<string, unknown>>;
  /** Chunk IDs of duplicate assistant messages that should be skipped */
  duplicateAssistantIds: Set<string>;
}

/**
 * Scan event history and build all dedup maps in a single pass.
 */
export function buildDedupMaps(events: SessionEvent[]): DedupResult {
  const runningChunksToSkip = new Set<string>();
  const runningArgsMap = new Map<string, Record<string, unknown>>();

  // ── Pass 1: Tool call/result dedup ──

  const transientByFunc = new Map<string, number[]>();
  const transientByCallId = new Map<string, number[]>();
  for (let idx = 0; idx < events.length; idx++) {
    const event = events[idx];
    if (event.actionType !== "tool_call" || !event.id) continue;

    const callId =
      event.callId || (event.result?.call_id as string | undefined);
    if (callId && event.args && Object.keys(event.args).length > 0) {
      runningArgsMap.set(callId, event.args);
    }

    const isRunning =
      event.result?.status === "running" || event.displayStatus === "running";
    const isCallRow = event.id.startsWith("tool-call-");
    if (!isRunning && !(isCallRow && callId)) continue;

    const fn = event.functionName || "";
    if (!transientByFunc.has(fn)) transientByFunc.set(fn, []);
    transientByFunc.get(fn)!.push(idx);
    if (callId) {
      if (!transientByCallId.has(callId)) transientByCallId.set(callId, []);
      transientByCallId.get(callId)!.push(idx);
    }
  }

  for (let jdx = 0; jdx < events.length; jdx++) {
    const event = events[jdx];
    if (
      event.actionType !== "tool_result" &&
      event.actionType !== "tool_call"
    ) {
      continue;
    }
    if (
      event.result?.status === "running" ||
      event.displayStatus === "running"
    ) {
      continue;
    }

    const callId =
      event.callId || (event.result?.call_id as string | undefined);
    const matchingTransientIndices = callId
      ? transientByCallId.get(callId)
      : transientByFunc.get(event.functionName || "");
    if (!matchingTransientIndices) continue;

    for (const transientIdx of matchingTransientIndices) {
      if (transientIdx >= jdx) continue;
      const transient = events[transientIdx];
      if (transient.id !== event.id) {
        runningChunksToSkip.add(transient.id);
      }
    }
  }

  // ── Pass 2: Assistant message content dedup ──

  const duplicateAssistantIds = buildAssistantDedupSet(events);

  return { runningChunksToSkip, runningArgsMap, duplicateAssistantIds };
}

/**
 * Public predicate: true when the event is a user-visible assistant/agent
 * message (as opposed to a tool call, system message, or raw event).
 *
 * Exported because turn-level UI actions (e.g., Regenerate) need to find
 * the last assistant message in a group without reimplementing the
 * classification rules.
 */
function isTurnSummaryEvent(event: SessionEvent): boolean {
  return (
    event.displayVariant === "summary" ||
    event.functionName === "turn_summary" ||
    event.uiCanonical === "turn_summary"
  );
}

export function isAssistantMessageEvent(event: SessionEvent): boolean {
  if (isTurnSummaryEvent(event)) return false;
  return (
    event.actionType === "assistant" ||
    event.functionName === "assistant_message" ||
    event.functionName === "agent_message" ||
    event.functionName === "message"
  );
}

function isAssistantMessage(event: SessionEvent): boolean {
  return isAssistantMessageEvent(event);
}

function isThinkingMessage(event: SessionEvent): boolean {
  return (
    event.displayVariant === "thinking" ||
    event.functionName === "thinking" ||
    event.actionType === "llm_thinking" ||
    event.actionType === "llm_thinking_delta"
  );
}

function extractAssistantText(event: SessionEvent): string {
  const result = event.result;
  if (!result) return event.displayText?.trim() ?? "";
  const content =
    (result["content"] as string | undefined) ??
    (result["observation"] as string | undefined) ??
    "";
  return content.trim();
}

function isTurnTextEvent(event: SessionEvent): boolean {
  return isAssistantMessage(event) || isThinkingMessage(event);
}

interface TextSegment {
  ids: string[];
  signature: string;
}

function buildTextSegment(events: SessionEvent[]): TextSegment | null {
  const parts: string[] = [];
  const ids: string[] = [];

  for (const event of events) {
    const text = extractAssistantText(event);
    if (!text) continue;
    const kind = isThinkingMessage(event) ? "thinking" : "assistant";
    parts.push(`${kind}:${text}`);
    ids.push(event.id);
  }

  if (parts.length === 0) return null;
  return { ids, signature: parts.join("\n---\n") };
}

/**
 * Identify duplicate assistant messages. Covers both single adjacent assistant
 * duplicates and repeated streaming segment pairs such as:
 * `thinking(A), assistant(B), thinking(A), assistant(B)`.
 */
function buildAssistantDedupSet(events: SessionEvent[]): Set<string> {
  const duplicates = new Set<string>();
  let prevText = "";
  let prevId = "";

  for (const event of events) {
    if (!isAssistantMessage(event)) {
      prevText = "";
      prevId = "";
      continue;
    }

    const text = extractAssistantText(event);
    if (!text) {
      prevText = "";
      prevId = "";
      continue;
    }

    if (text === prevText && prevId) {
      duplicates.add(prevId);
    }

    prevText = text;
    prevId = event.id;
  }

  let pendingTextEvents: SessionEvent[] = [];
  let previousSegment: TextSegment | null = null;

  const flushSegment = () => {
    const currentSegment = buildTextSegment(pendingTextEvents);
    pendingTextEvents = [];
    if (!currentSegment) return;

    if (
      previousSegment &&
      previousSegment.signature === currentSegment.signature
    ) {
      for (const id of previousSegment.ids) {
        duplicates.add(id);
      }
    }

    previousSegment = currentSegment;
  };

  for (const event of events) {
    if (!isTurnTextEvent(event)) {
      flushSegment();
      previousSegment = null;
      continue;
    }

    pendingTextEvents.push(event);
    if (isAssistantMessage(event)) {
      flushSegment();
    }
  }
  flushSegment();

  return duplicates;
}
