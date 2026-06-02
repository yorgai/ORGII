/**
 * Shared mode-switch logic used by both ModeSwitchEvent (chat history)
 * and ModeSwitchInputCard (input area).
 *
 * Provides:
 * - Resolved-event cache (so both components agree on which events are handled)
 * - MODE_LABELS lookup
 * - switchMode / skipMode action helpers
 */
import { respondModeSwitch } from "@src/api/tauri/agent";
import { cursorBridgeSetMode } from "@src/api/tauri/cursorBridge";
import { rpc } from "@src/api/tauri/rpc";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { eventsAtom } from "@src/engines/SessionCore/core/atoms";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { creatorDefaultModelSelectionAtom } from "@src/store/session/creatorDefaultModelAtom";
import { cursorModeOverrideAtomFamily } from "@src/store/session/cursorModeOverrideAtom";
import { sessionByIdAtom, upsertSession } from "@src/store/session/sessionAtom";
import { activeSessionIdAtom } from "@src/store/session/viewAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { resolveModelForMessage } from "@src/util/session/resolveModelForMessage";
import {
  composerIdFromSessionId,
  isAgentSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

// ============================================
// Resolved cache
// ============================================

export type ModeSwitchResolution = "switched" | "skipped";

const MAX_RESOLVED_CACHE = 200;
const resolvedEvents = new Map<string, ModeSwitchResolution>();

export function getResolution(
  eventId: string
): ModeSwitchResolution | undefined {
  return resolvedEvents.get(eventId);
}

export function isResolved(eventId: string): boolean {
  return resolvedEvents.has(eventId);
}

function markResolved(eventId: string, status: ModeSwitchResolution) {
  if (resolvedEvents.size >= MAX_RESOLVED_CACHE) {
    const firstKey = resolvedEvents.keys().next().value;
    if (firstKey) resolvedEvents.delete(firstKey);
  }
  resolvedEvents.set(eventId, status);
}

// ============================================
// Mode labels
// ============================================

export const MODE_LABELS: Record<string, string> = {
  build: "Build",
  investigate: "Ask",
  plan: "Plan",
  debug: "Debug",
  review: "Review",
};

// ============================================
// Actions
// ============================================

async function markModeSwitchEventResolved(
  eventId: string,
  sessionId: string,
  resolution: ModeSwitchResolution,
  targetMode?: string
): Promise<void> {
  await eventStoreProxy.updateById(
    eventId,
    {
      displayStatus: "completed",
      activityStatus: "processed",
      result: {
        choice: resolution === "switched" ? "switch" : "skip",
        targetMode,
      },
    },
    sessionId
  );
}

/**
 * Patterns that indicate the user's message was itself a mode-switch command
 * rather than a real task. Re-sending these into the new mode would trigger
 * another suggest_mode_switch call and create an infinite loop.
 */
const MODE_SWITCH_COMMAND_PATTERNS = [
  /switch\s*(to\s*)?(plan|build|debug|investigate|review)\s*mode?/i,
  /enter\s*(plan|build|debug|investigate|review)\s*mode?/i,
  /go\s+to\s*(plan|build|debug|investigate|review)\s*mode?/i,
  /use\s*(plan|build|debug|investigate|review)\s*mode?/i,
  /切换.*mode/i,
  /切.*plan/i,
  /进入.*mode/i,
  /切.*模式/i,
];

function isModeSwitchCommand(text: string): boolean {
  return MODE_SWITCH_COMMAND_PATTERNS.some((re) => re.test(text));
}

function getLastUserText(): string {
  const store = getInstrumentedStore();
  const events = store.get(eventsAtom);
  for (let idx = events.length - 1; idx >= 0; idx--) {
    if (events[idx].source === "user" && events[idx].displayText) {
      return events[idx].displayText;
    }
  }
  return "";
}

async function switchCursorIdeMode(
  eventId: string,
  sessionId: string,
  targetMode: string
): Promise<void> {
  const composerId = composerIdFromSessionId(sessionId);
  // Bug-fix: must mark the event resolved even when composerId is missing,
  // otherwise the chat history event stays stuck at awaiting_user forever
  // while the module cache considers it resolved and suppresses the card.
  await markModeSwitchEventResolved(eventId, sessionId, "switched", targetMode);
  if (!composerId) return;

  const store = getInstrumentedStore();
  store.set(cursorModeOverrideAtomFamily(sessionId), targetMode);
  await cursorBridgeSetMode({ agentId: composerId, modeId: targetMode });

  const lastUserText = getLastUserText();
  // Bug-fix: same guard as switchAgentMode — skip resend when the user's
  // last message was itself a mode-switch command to avoid an infinite loop.
  if (!lastUserText || isModeSwitchCommand(lastUserText)) return;

  await SessionService.sendMessage({
    sessionId,
    content: lastUserText,
    mode: targetMode,
  });
}

async function switchAgentMode(
  eventId: string,
  sessionId: string,
  targetMode: string
): Promise<void> {
  await markModeSwitchEventResolved(eventId, sessionId, "switched", targetMode);

  const store = getInstrumentedStore();

  // Persist the new mode on the session row instead of the global
  // creator-default atom — otherwise switching plan→build for one
  // session would silently change the default for every new session
  // the user creates afterwards. Optimistic upsert so the ModePill
  // and mode-aware UI repaint on the same frame.
  const sessionBefore = store.get(sessionByIdAtom(sessionId));
  if (sessionBefore) {
    upsertSession({
      ...sessionBefore,
      agentExecMode: targetMode as AgentExecMode,
    });
  }
  await rpc.sessionAggregate.patch({
    sessionId,
    patch: { agentExecMode: targetMode },
  });

  await respondModeSwitch(sessionId, "switch", targetMode);

  const lastUserText = getLastUserText();
  // Do not resend if there is no prior user message, or if the last user
  // message was itself a mode-switch command. Resending a request to switch
  // into Plan mode would trigger another suggest_mode_switch call and
  // create an infinite switching loop.
  if (!lastUserText || isModeSwitchCommand(lastUserText)) return;

  // Use the session row's model/account for the resend if it has one
  // (an actual in-session selection beats the creator-default), and
  // fall back to the localStorage-backed default only when the row
  // has no model yet (very first turn, before any model picker
  // interaction).
  const sessionForSend = store.get(sessionByIdAtom(sessionId));
  const fallback = store.get(creatorDefaultModelSelectionAtom);
  const lastModelSelection = sessionForSend?.model
    ? {
        ...fallback,
        keySource: sessionForSend.keySource ?? fallback?.keySource,
        model: sessionForSend.model,
        selectedAccountId:
          sessionForSend.accountId ?? fallback?.selectedAccountId,
        cliAgentType: sessionForSend.cliAgentType ?? fallback?.cliAgentType,
        tier: sessionForSend.tier ?? fallback?.tier,
      }
    : fallback;
  const { model, accountId } = resolveModelForMessage(lastModelSelection);

  await SessionService.sendMessage({
    sessionId,
    content: lastUserText,
    model,
    accountId,
    mode: targetMode,
  });
}

function isE2EModeSwitchMockEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    window.__ORGII_E2E_MODE_SWITCH_MOCK__ === true
  );
}

export async function switchMode(
  eventId: string,
  targetMode: string
): Promise<void> {
  const store = getInstrumentedStore();
  const sessionId = store.get(activeSessionIdAtom);
  if (!sessionId) return;

  markResolved(eventId, "switched");

  if (isE2EModeSwitchMockEnabled()) {
    await markModeSwitchEventResolved(
      eventId,
      sessionId,
      "switched",
      targetMode
    );
    const sessionBefore = store.get(sessionByIdAtom(sessionId));
    if (sessionBefore) {
      upsertSession({
        ...sessionBefore,
        agentExecMode: targetMode as AgentExecMode,
      });
    }
    return;
  }

  if (isCursorIdeSession(sessionId)) {
    await switchCursorIdeMode(eventId, sessionId, targetMode);
    return;
  }

  if (isAgentSession(sessionId)) {
    await switchAgentMode(eventId, sessionId, targetMode);
  }
}

export async function skipMode(eventId: string): Promise<void> {
  const store = getInstrumentedStore();
  const sessionId = store.get(activeSessionIdAtom);
  if (!sessionId) return;

  markResolved(eventId, "skipped");
  await markModeSwitchEventResolved(eventId, sessionId, "skipped");

  if (isAgentSession(sessionId)) {
    await respondModeSwitch(sessionId, "skip");
  }
}
