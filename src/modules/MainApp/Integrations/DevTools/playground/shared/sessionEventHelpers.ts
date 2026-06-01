import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";
import type { MessageEntry } from "@src/modules/WorkStation/Chat/Communication/types";
import { convertToMessageEntry } from "@src/modules/WorkStation/Chat/Communication/utils";

export interface ParsedEventResult {
  data: SessionEvent | null;
  error: string | null;
}

/**
 * Parse JSON input and merge with a display status to produce a {@link SessionEvent}.
 * Uses {@link EventDisplayStatus} — not `EventStatus` from universal props.
 */
export function parseSessionEventFromJson(
  jsonInput: string,
  status: EventDisplayStatus
): ParsedEventResult {
  try {
    const parsed = JSON.parse(jsonInput) as Record<string, unknown>;
    const event = buildPlaygroundSessionEvent({
      id:
        (parsed.id as string) ||
        (parsed.chunk_id as string) ||
        `pg-${Date.now()}`,
      chunk_id: (parsed.chunk_id as string) || null,
      sessionId:
        (parsed.sessionId as string) ||
        (parsed.session_id as string) ||
        "playground-preview",
      functionName:
        (parsed.functionName as string) || (parsed.function as string) || "",
      actionType:
        (parsed.actionType as string) ||
        (parsed.action_type as string) ||
        "tool_call",
      args: (parsed.args as Record<string, unknown>) || {},
      result: (parsed.result as Record<string, unknown>) || {},
      createdAt:
        (parsed.createdAt as string) ||
        (parsed.created_at as string) ||
        new Date().toISOString(),
      displayStatus: status,
      callId:
        (parsed.callId as string) || (parsed.call_id as string) || undefined,
      threadId:
        (parsed.threadId as string) ||
        (parsed.thread_id as string) ||
        undefined,
      processId:
        (parsed.processId as string) ||
        (parsed.process_id as string) ||
        undefined,
    });
    return { data: event, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export function buildPlaygroundSessionEvent(
  overrides: Omit<Partial<SessionEvent>, "id"> & { id: string }
): SessionEvent {
  return {
    chunk_id: null,
    sessionId: "playground-preview",
    createdAt: new Date().toISOString(),
    functionName: "assistant",
    uiCanonical: "",
    actionType: "assistant",
    args: {},
    result: {},
    source: "assistant",
    displayText: "",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    ...overrides,
  };
}

export function playgroundChatMessageEntry(
  messageId: string,
  sender: "user" | "agent",
  text: string
): MessageEntry {
  const isUser = sender === "user";
  const event = buildPlaygroundSessionEvent({
    id: messageId,
    chunk_id: messageId,
    functionName: isUser ? "user_input" : "assistant",
    actionType: isUser ? "user_input" : "assistant",
    args: isUser ? { message: text } : { content: text },
    source: isUser ? "user" : "assistant",
    displayText: text,
    displayVariant: "message",
    result: {},
  });
  return convertToMessageEntry(event, "chat", false);
}
