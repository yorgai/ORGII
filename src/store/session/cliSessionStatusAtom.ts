/**
 * Session Runtime Atoms
 *
 * Tracks the UI-effective session run status for all session types.
 *
 * Rust `status_changed` events are authoritative once they arrive, but dispatch
 * paths may set optimistic `running`/`idle` values before the first event so the
 * composer, Stop button, and queue UX react immediately.
 */
import { atom } from "jotai";

import type { CliSessionStatus } from "@src/types/session/session";

// Single source of truth: @src/types/session/session
export type { CliSessionStatus } from "@src/types/session/session";

// ============================================
// Core Session Runtime Atoms
// ============================================

/** UI-effective session run status; Rust events overwrite optimistic values. */
export const sessionRuntimeStatusAtom = atom<CliSessionStatus>("idle");
sessionRuntimeStatusAtom.debugLabel = "sessionRuntimeStatus";

export type SessionRuntimeStatusSource =
  | "dispatch"
  | "queue"
  | "sync"
  | "timeline-boundary"
  | "planning"
  | "launch"
  | "interactive-event"
  | "repo-setup"
  | "session-reset"
  | "e2e";

export const setSessionRuntimeStatusAtom = atom(
  null,
  (
    _get,
    set,
    update: { status: CliSessionStatus; source: SessionRuntimeStatusSource }
  ) => {
    set(sessionRuntimeStatusAtom, update.status);
  }
);
setSessionRuntimeStatusAtom.debugLabel = "setSessionRuntimeStatus";

/** Error message from the last failed session run. Cleared on new run start. */
export const sessionRuntimeErrorAtom = atom<string | null>(null);
sessionRuntimeErrorAtom.debugLabel = "sessionRuntimeError";

/**
 * Transient stream-retry status.
 *
 * Set by the `agent:stream_retry` event when the Rust turn executor is
 * silently retrying a network-interrupted LLM call (per-chunk idle timeout,
 * transport drop, provider 5xx). Rendered as a low-key footer indicator
 * above the input area — NEVER as a chat bubble.
 *
 * Cleared on:
 * - `agent:stream_error_exhausted` (promoted to `sessionRuntimeErrorAtom`)
 * - next successful `agent:message_delta` / `agent:tool_call` after recovery
 * - `agent:complete`
 */
export interface StreamRetryStatus {
  sessionId: string;
  kind: string;
  attempt: number;
  maxAttempts: number;
  backoffMs: number;
  /** Epoch ms at which we received the event; used by the UI to animate the countdown. */
  startedAt: number;
}
export const streamRetryStatusAtom = atom<StreamRetryStatus | null>(null);
streamRetryStatusAtom.debugLabel = "streamRetryStatus";

/** Total tokens consumed in the current session. Updated via token_usage events. */
export const sessionContextTokensAtom = atom<number>(0);
sessionContextTokensAtom.debugLabel = "sessionContextTokens";

/**
 * Per-category context window breakdown.
 *
 * Emitted by Rust inside `agent:complete` once the backend is wired to
 * report per-category token counts. Until then, any field that the Rust side
 * does NOT emit will remain `undefined` and the UI falls back to mock values
 * for that category only.
 */
export interface ContextBreakdown {
  systemPromptTokens?: number;
  toolsTokens?: number;
  rulesTokens?: number;
  skillsTokens?: number;
  mcpTokens?: number;
  subagentTokens?: number;
  summaryTokens?: number;
  conversationTokens?: number;
}

/**
 * Set once per `agent:complete` event when Rust emits a context breakdown.
 * Null until the first complete event with breakdown data arrives.
 */
export const sessionContextBreakdownAtom = atom<ContextBreakdown | null>(null);
sessionContextBreakdownAtom.debugLabel = "sessionContextBreakdown";

/**
 * Pending-cancel flag.
 *
 * Set to `true` the moment the user clicks the stop button. Cleared when Rust
 * broadcasts a terminal status (the actual turn wind-down).
 *
 * Used by the "silent queue" UX: while this flag is true, any new user message
 * is enqueued (not dispatched) so the user never sees a "wait, the agent is
 * still stopping" state. User Stop never auto-flushes preserved queued
 * follow-ups; only an explicit Send Now or a later natural turn completion may
 * release them.
 */
export const isPendingCancelAtom = atom<boolean>(false);
isPendingCancelAtom.debugLabel = "isPendingCancel";

/**
 * User-initiated cancel flag.
 *
 * Set to `true` alongside `isPendingCancelAtom` when the user presses the stop
 * button (as opposed to a Rust-side failure that incidentally clears pending).
 * The queue flusher consumes this once after the cancel settles: instead of
 * auto-dispatching queued follow-ups, the active in-flight prompt is restored
 * to the input box so the user can edit/cancel before re-sending. The queued
 * follow-ups stay in place and auto-flush normally after the user resends (or
 * they can clear them manually).
 *
 * Cleared by `useQueueDispatch` after it consumes the restore, or on the next
 * fresh `status_changed -> running` event, whichever comes first.
 */
export const userInitiatedCancelAtom = atom<boolean>(false);
userInitiatedCancelAtom.debugLabel = "userInitiatedCancel";

/**
 * Pending "restore message to input box" signal.
 *
 * Set when a user-initiated cancel needs to put the active in-flight prompt
 * back into the composer. `useInputArea` observes this atom and injects the
 * text into the tiptap editor, then clears the signal.
 *
 * Object shape (not just a string) so we can include imageDataUrls in a
 * follow-up without another atom.
 */
export interface RestoreToInputPayload {
  displayContent: string;
  imageDataUrls?: string[];
}
export const restoreToInputAtom = atom<RestoreToInputPayload | null>(null);
restoreToInputAtom.debugLabel = "restoreToInput";

/**
 * Last user message displayed in the current session. Captured at dispatch
 * time (not derived from events) so the cancel-restore path can put the
 * exact text + images the user typed back into the input box without
 * having to scan the event store.
 */
export interface LastUserMessagePayload {
  displayContent: string;
  imageDataUrls?: string[];
}
export const lastUserMessageAtom = atom<LastUserMessagePayload | null>(null);
lastUserMessageAtom.debugLabel = "lastUserMessage";

/**
 * Set to `true` when the user cancels before any agent output (Scenario A),
 * causing the session to be rolled back to an empty state. Cleared when the
 * session starts running again (next message sent successfully).
 *
 * Used by ChatHistory to suppress the empty-activity reload error placeholder —
 * the session is intentionally empty, not broken.
 */
export const sessionRolledBackAtom = atom<boolean>(false);
sessionRolledBackAtom.debugLabel = "sessionRolledBack";

// ============================================
// Derived Status Atoms
// ============================================

/** Whether the session engine is actively running or blocked on user input/funds. */
export const isSessionEngineActiveAtom = atom<boolean>((get) => {
  const status = get(sessionRuntimeStatusAtom);
  return (
    status === "running" ||
    status === "installing" ||
    status === "waiting_for_user" ||
    status === "waiting_for_funds"
  );
});
isSessionEngineActiveAtom.debugLabel = "isSessionEngineActive";

/**
 * Universal "is any session actively working?" signal.
 *
 * Derives entirely from sessionRuntimeStatusAtom (Rust-pushed).
 * Replaces the old triple-atom approach (manual toggle + event heuristic + engine status).
 */
export const isSessionActiveAtom = atom<boolean>((get) => {
  return get(isSessionEngineActiveAtom);
});
isSessionActiveAtom.debugLabel = "isSessionActive";
