/**
 * useTodoSync Hook
 *
 * Syncs manage_todo events from session updates into the per-session
 * todo slot. Two data paths:
 *
 * 1. **Cold-start / session switch**: `getTodos(sessionId)` fetches
 *    persisted todos from the Rust SQLite backend.
 * 2. **Simulator events (replay)**: scans `simulatorEventsAtom` for
 *    the latest `manage_todo` tool-call event up to the current
 *    replay cursor.
 *
 * Real-time push from `agent:todos_updated` is handled upstream in
 * `handleTodosUpdated` (eventHandlers/agentSpecific.ts), which writes
 * directly to `updateTodosForSessionAtom` via the Jotai store — no
 * browser CustomEvent relay needed.
 */
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";

import { getTodos } from "@src/api/tauri/agent";
import { currentEventAtom } from "@src/engines/SessionCore/core/atoms";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { simulatorEventsAtom } from "@src/engines/SessionCore/derived/simulatorEvents";
import { extractTodoData } from "@src/engines/SessionCore/rendering/props";
import { normalizeActivity } from "@src/lib/activityData";
import { isTodoEvent } from "@src/modules/WorkStation/Chat/Communication/utils";
import {
  type TodoItem,
  clearTodosForSessionAtom,
  getTodosForSession,
  sessionTodoMapAtom,
  updateTodosForSessionAtom,
} from "@src/store/ui/todoAtom";

import {
  type RawPersistedTodoItem,
  isExpectedTodoLoadRejection,
  normalizePersistedTodo as normalizePersistedTodoCore,
  normalizePersistedTodoList as normalizePersistedTodoListCore,
  sanitizeTodoDisplayText,
} from "./todoNormalization";

// ============================================
// Helper Functions
// ============================================

export function isManageTodoEvent(event: SessionEvent): boolean {
  const fn = event.functionName || "";
  const actionType = event.actionType || "";

  if (fn && isTodoEvent(fn)) return true;
  if (actionType && isTodoEvent(actionType)) return true;

  return false;
}

/**
 * Re-export the dependency-light normalisation helpers so the
 * existing consumers of `useTodoSync` (and its tests) don't have to
 * change their import paths. The actual implementations live in
 * `./todoNormalization` so they can be unit-tested without pulling
 * in jotai atoms (which require `localStorage`).
 */
export type { RawPersistedTodoItem };
export const normalizePersistedTodo = normalizePersistedTodoCore;
export const normalizePersistedTodoList = normalizePersistedTodoListCore;

function extractTodosFromEvent(event: SessionEvent): TodoItem[] {
  const normalized = normalizeActivity(
    event as unknown as Record<string, unknown>
  );

  const todoData = extractTodoData({
    eventId: event.id,
    eventType: "manage_todo",
    args: normalized.args,
    result: normalized.result,
    status: "success" as const,
    variant: "chat" as const,
    context: "chat" as const,
  });

  return todoData.todos.map((todo) => {
    const raw = todo as unknown as Record<string, unknown>;
    const activeForm =
      typeof raw.activeForm === "string" && raw.activeForm.length > 0
        ? (raw.activeForm as string)
        : undefined;
    const blockedBy = Array.isArray(raw.blockedBy)
      ? (raw.blockedBy as number[])
      : todo.blockedBy;
    return {
      id: todo.id || crypto.randomUUID(),
      content: sanitizeTodoDisplayText(todo.content || ""),
      activeForm: activeForm ? sanitizeTodoDisplayText(activeForm) : undefined,
      status: (todo.status || "pending") as TodoItem["status"],
      ...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
    };
  });
}

// ============================================
// Hook
// ============================================

export function useTodoSync(sessionId?: string): void {
  const simulatorEvents = useAtomValue(simulatorEventsAtom);
  const currentEvent = useAtomValue(currentEventAtom);
  const updateTodosForSession = useSetAtom(updateTodosForSessionAtom);
  const clearTodosForSession = useSetAtom(clearTodosForSessionAtom);
  const store = useStore();

  const lastSessionIdRef = useRef<string | undefined>(sessionId);
  const processedCountRef = useRef<number>(0);
  const lastProcessedTodoIdRef = useRef<string | null>(null);
  const lastCurrentEventIdRef = useRef<string | null>(null);

  // Clear todos on session change, then load persisted todos from backend
  useEffect(() => {
    if (sessionId !== lastSessionIdRef.current) {
      const prev = lastSessionIdRef.current;
      lastSessionIdRef.current = sessionId;
      processedCountRef.current = 0;
      lastProcessedTodoIdRef.current = null;
      // Only clear when actually switching to a *different* session.
      // A transient undefined (panel remount / layout shuffle) must not
      // wipe the live slot — that caused the todo pill to flash 0 and
      // then "recover" via the async getTodos reload below.
      if (prev && sessionId && prev !== sessionId) clearTodosForSession(prev);
    }

    if (!sessionId) return;

    let cancelled = false;
    const currentSessionId = sessionId;

    getTodos(currentSessionId)
      .then((items) => {
        if (cancelled) return;
        if (currentSessionId !== lastSessionIdRef.current) return;
        // Cold-start restore only: if live `agent:todos_updated` pushes
        // already populated this slot while the fetch was in flight, the
        // persisted snapshot is staler than what's on screen — overwriting
        // would visibly regress the progress pill (e.g. 6/12 → 0/12).
        const liveTodos = getTodosForSession(
          store.get(sessionTodoMapAtom),
          currentSessionId
        );
        if (liveTodos.length > 0) return;
        const todos = normalizePersistedTodoList(items);
        if (todos.length === 0) return;
        updateTodosForSession({
          sessionId: currentSessionId,
          todos,
          merge: false,
        });
      })
      .catch((err) => {
        // Previously this catch was a complete no-op which masked
        // "todos never reload after refresh" bugs whenever the
        // Rust side returned an unexpected rejection (transport
        // error, schema mismatch, etc.). We now keep silent for
        // the *known* benign rejection — "session is not a coding
        // agent" — and warn loudly for everything else.
        if (cancelled) return;
        if (isExpectedTodoLoadRejection(err)) return;
        console.warn(
          `[useTodoSync] Failed to load persisted todos (session=${currentSessionId}):`,
          err
        );
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, clearTodosForSession, updateTodosForSession, store]);

  // Process todo events — find the LATEST manage_todo event up to current replay position
  useEffect(() => {
    if (!sessionId) return;
    if (!simulatorEvents || simulatorEvents.length === 0) return;

    const currentEventId = currentEvent?.id ?? null;

    if (
      simulatorEvents.length === processedCountRef.current &&
      currentEventId === lastCurrentEventIdRef.current
    ) {
      return;
    }

    let maxIndex = simulatorEvents.length - 1;
    if (currentEventId) {
      const currentIndex = simulatorEvents.findIndex(
        (event) => event.id === currentEventId
      );
      if (currentIndex !== -1) {
        maxIndex = currentIndex;
      }
    }

    let latestTodoEvent: SessionEvent | null = null;
    for (let index = maxIndex; index >= 0; index--) {
      const event = simulatorEvents[index];
      if (isManageTodoEvent(event)) {
        // Skip events that belong to a different session (e.g. a subagent
        // whose manage_todo leaked into the parent's event stream).
        const eventSid = event.sessionId;
        if (eventSid && eventSid !== sessionId) continue;
        latestTodoEvent = event;
        break;
      }
    }

    processedCountRef.current = simulatorEvents.length;
    lastCurrentEventIdRef.current = currentEventId;

    if (!latestTodoEvent) return;
    if (latestTodoEvent.id === lastProcessedTodoIdRef.current) return;

    const todos = extractTodosFromEvent(latestTodoEvent);

    if (todos.length > 0) {
      updateTodosForSession({
        sessionId,
        todos,
        merge: false,
        timestamp: latestTodoEvent.createdAt,
      });
    }

    lastProcessedTodoIdRef.current = latestTodoEvent.id;
  }, [sessionId, simulatorEvents, currentEvent, updateTodosForSession]);
}

export default useTodoSync;
