/**
 * Shell Process Handlers
 *
 * Handlers for exec_output and shell process lifecycle events
 * (agent:shell_process_started, agent:shell_process_backgrounded,
 * agent:shell_process_exited).
 */
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { updateShellProcessAtom } from "@src/store/session/shellProcessAtom";

import type { AgentWSEvent } from "../../shared/types";
import { type EventHandlerContext, MAX_EXEC_BUFFER } from "./types";

export function handleExecOutput(
  event: AgentWSEvent,
  ctx: EventHandlerContext
): void {
  const execStream = event.stream ?? "stdout";
  if (!event.chunk || (execStream !== "stdout" && execStream !== "stderr"))
    return;

  ctx.execOutputBufferRef.current += event.chunk;
  if (ctx.execOutputBufferRef.current.length > MAX_EXEC_BUFFER) {
    ctx.execOutputBufferRef.current =
      ctx.execOutputBufferRef.current.slice(-MAX_EXEC_BUFFER);
  }

  // Pass event.sessionId explicitly so the update targets the correct session
  // store. Without it, Rust falls back to active_id() which may differ from
  // the session that owns the shell tool_call (e.g. a subagent session).
  eventStoreProxy.updateLastShellOutput(
    ctx.execOutputBufferRef.current,
    event.sessionId ?? undefined
  );

  // OS Agent dispatches window event
  if (ctx.features.hasCodingSessionBridge) {
    window.dispatchEvent(
      new CustomEvent("agent-exec-output", {
        detail: {
          sessionId: event.sessionId,
          chunk: event.chunk ?? "",
          stream: execStream,
        },
      })
    );
  }
}

/**
 * Handle shell process started event.
 * Updates shellProcessAtom and the last shell event's pid/status.
 */
export function handleShellProcessStarted(
  event: AgentWSEvent,
  sessionId: string | undefined,
  ctx: EventHandlerContext
): void {
  const resolvedSessionId =
    sessionId || event.sessionId || ctx.filterSessionIdRef.current || "";
  const pid = event.pid;
  const command = event.command || "";
  const logPath = event.logPath;

  if (!pid || !resolvedSessionId) return;

  const store = ctx.getDefaultStore();
  if (store) {
    store.set(updateShellProcessAtom, {
      type: "start",
      sessionId: resolvedSessionId,
      pid,
      command,
      logPath,
    });
  }

  eventStoreProxy.updateLastShellProcess(
    pid,
    "running",
    undefined,
    logPath,
    resolvedSessionId
  );
}

/**
 * Handle shell process backgrounded event.
 *
 * Emitted when `run_shell` spawns with `mode="background"` (reason: "explicit")
 * or when a blocking run hits `wait_secs` without exiting (reason: "timeout").
 * Transitions the last shell event's `shellProcessStatus` from `"running"` to
 * `"background"` so `TerminalBlock` keeps the chat card expanded with a
 * "backgrounded · PID N" chip and the Stop button remains active until
 * `shell_process_exited` eventually arrives.
 */
export function handleShellProcessBackgrounded(
  event: AgentWSEvent,
  sessionId: string | undefined,
  ctx: EventHandlerContext
): void {
  const resolvedSessionId =
    sessionId || event.sessionId || ctx.filterSessionIdRef.current || "";
  const pid = event.pid;
  const logPath = event.logPath;

  if (!pid || !resolvedSessionId) return;

  const store = ctx.getDefaultStore();
  if (store) {
    store.set(updateShellProcessAtom, {
      type: "background",
      sessionId: resolvedSessionId,
      pid,
    });
  }

  eventStoreProxy.updateLastShellProcess(
    pid,
    "background",
    undefined,
    logPath,
    resolvedSessionId
  );
}

/**
 * Handle shell process exited event.
 * Updates shellProcessAtom status and the last shell event's processStatus.
 */
export function handleShellProcessExited(
  event: AgentWSEvent,
  sessionId: string | undefined,
  ctx: EventHandlerContext
): void {
  const resolvedSessionId =
    sessionId || event.sessionId || ctx.filterSessionIdRef.current || "";
  const pid = event.pid;
  const exitCode = event.exitCode;
  const killed = event.killed ?? false;

  if (!pid || !resolvedSessionId) return;

  const store = ctx.getDefaultStore();
  if (store) {
    store.set(updateShellProcessAtom, {
      type: "exit",
      sessionId: resolvedSessionId,
      pid,
      exitCode,
      killed,
    });
  }

  const status = killed ? "killed" : "exited";
  eventStoreProxy.updateLastShellProcess(
    pid,
    status,
    exitCode,
    undefined,
    resolvedSessionId
  );
}
