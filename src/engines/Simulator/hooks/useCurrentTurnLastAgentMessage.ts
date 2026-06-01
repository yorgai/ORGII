/**
 * useCurrentTurnLastAgentMessage (simulator)
 *
 * Returns the most recent agent text message of the CURRENT simulator
 * turn — i.e. the latest agent reply that is at-or-before the replay
 * cursor and still inside the turn the cursor sits in. A "turn" starts
 * at a user message and ends just before the next user message; if there
 * is no user message yet, the whole timeline up to the cursor counts as
 * the current turn.
 *
 * Used by the floating caption bar above the SimulatorStatusBar to keep
 * the latest agent reply visible while the user free-browses tool calls
 * between two user messages.
 *
 * Returns `null` when the timeline is empty or the current turn has no
 * agent text message yet.
 */
import { useAtomValue } from "jotai";

import {
  currentSimulatorEventIndexAtom,
  effectiveSimulatorEventIdsAtom,
  simulatorEventPreviewByIdAtom,
} from "@src/engines/SessionCore";
import type { SimulatorEventPreview } from "@src/engines/SessionCore";

export interface CurrentTurnLastAgentMessage {
  text: string;
  /** Event id of the source agent message, useful for keying renderers. */
  eventId: string;
  /** Whether the replay cursor is currently on this exact agent message event. */
  isCurrentEvent: boolean;
}

function isAssistantMessagePreview(preview: SimulatorEventPreview): boolean {
  return (
    preview.actionType === "assistant" ||
    preview.functionName === "assistant_message" ||
    preview.functionName === "agent_message" ||
    preview.functionName === "message"
  );
}

export function useCurrentTurnLastAgentMessage(): CurrentTurnLastAgentMessage | null {
  const eventIds = useAtomValue(effectiveSimulatorEventIdsAtom);
  const previewById = useAtomValue(simulatorEventPreviewByIdAtom);
  const currentIndex = useAtomValue(currentSimulatorEventIndexAtom);

  if (eventIds.length === 0) return null;

  const cursor =
    currentIndex < 0 || currentIndex >= eventIds.length
      ? eventIds.length - 1
      : currentIndex;

  let turnStart = 0;
  for (let index = cursor; index >= 0; index--) {
    const preview = previewById[eventIds[index]];
    if (preview?.source === "user" && preview.displayText) {
      turnStart = index;
      break;
    }
  }

  for (let index = cursor; index >= turnStart; index--) {
    const preview = previewById[eventIds[index]];
    if (!preview || !isAssistantMessagePreview(preview)) continue;
    const text = preview.displayText?.trim();
    if (!text) continue;
    return { text, eventId: preview.id, isCurrentEvent: index === cursor };
  }

  return null;
}
