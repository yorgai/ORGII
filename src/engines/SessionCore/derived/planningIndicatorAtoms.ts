/**
 * Stable derived atoms for the global planning-indicator booleans.
 *
 * Both atoms compute a boolean from `derivedSnapshotAtom`. Jotai only
 * notifies subscribers when the returned value changes, so components that
 * read these atoms re-render only when the state actually flips (e.g. a
 * running tool call completes) — NOT on every streamed token.
 *
 * Previously these computations lived as `useMemo` calls inside
 * `usePlanningIndicator`, which meant `ChatHistory/index.tsx` re-rendered on
 * every snapshot update (i.e. every token) because `derivedSnapshotAtom`
 * itself changed that frequently.
 */
import { atom } from "jotai";

import { derivedSnapshotAtom } from "../core/atoms/events";
import { isInteractiveTool } from "../core/interactiveTools";
import {
  hasLiveRuntimeResourceInLatestTurn,
  hasRunningAwaitWaitForInLatestTurn,
} from "../core/runningEventGate";

/**
 * True when the latest agent turn has at least one live runtime resource
 * (e.g. a running shell process). Changes only when run state transitions,
 * not on every streaming token.
 */
export const globalAnyRunningAtom = atom((get) => {
  const snapshot = get(derivedSnapshotAtom);
  if (!snapshot || !("chatEvents" in snapshot)) return false;
  return hasLiveRuntimeResourceInLatestTurn(snapshot.chatEvents);
});
globalAnyRunningAtom.debugLabel = "planning/globalAnyRunning";

/**
 * True when the latest turn has a still-running `await_output` wait_for call.
 * Its own live "Waiting {countdown} for …" title already conveys activity, so
 * the planning footer is suppressed in this window to avoid two stacked
 * waiting indicators. Changes only when the wait_for starts/ends.
 */
export const globalHasRunningAwaitWaitForAtom = atom((get) => {
  const snapshot = get(derivedSnapshotAtom);
  if (!snapshot || !("chatEvents" in snapshot)) return false;
  return hasRunningAwaitWaitForInLatestTurn(snapshot.chatEvents);
});
globalHasRunningAwaitWaitForAtom.debugLabel =
  "planning/globalHasRunningAwaitWaitFor";

/**
 * True when there is a pending interactive tool call awaiting user input.
 * Changes only when an interactive event arrives or is processed, not on
 * every streaming token.
 */
export const globalHasAwaitingUserInteractionAtom = atom((get) => {
  const snapshot = get(derivedSnapshotAtom);
  if (!snapshot || !("events" in snapshot)) return false;
  return snapshot.events.some(
    (event) =>
      event.displayStatus === "awaiting_user" &&
      event.activityStatus !== "processed" &&
      isInteractiveTool(event.functionName)
  );
});
globalHasAwaitingUserInteractionAtom.debugLabel =
  "planning/globalHasAwaitingUserInteraction";

/**
 * True when the last chat-visible event is a settled (non-streaming)
 * assistant message. In this state the slow-hint is suppressed so the
 * user isn't confused while the backend winds down after a completed reply.
 * Changes only when the last event changes, not on every streaming token.
 */
export const globalLastIsSettledAssistantMessageAtom = atom((get) => {
  const snapshot = get(derivedSnapshotAtom);
  if (!snapshot) return false;
  const chat =
    "chatEvents" in snapshot && Array.isArray(snapshot.chatEvents)
      ? snapshot.chatEvents
      : [];
  const last = chat[chat.length - 1];
  if (!last) return false;
  return (
    last.actionType === "assistant" &&
    last.displayStatus === "completed" &&
    !last.isDelta
  );
});
globalLastIsSettledAssistantMessageAtom.debugLabel =
  "planning/globalLastIsSettledAssistantMessage";
