/**
 * useSimulatorSubagents
 *
 * Manages subagent child session state for ActivitySimulator:
 * - Queries DB for child sessions (re-fetches on eventStoreVersion change)
 * - Computes cursor-active subagents for the split pane
 * - Syncs allSubagentSessions to simulatorSubagentSessionsAtom (for
 *   SessionReplayMessages SubagentChip rows, without prop drilling)
 * - Manages split pane dismiss/reveal state
 *
 * Bug 5 note: trigger is eventStoreVersion (not event_count / events.length).
 * See Documentation/Agent/subagent-rendering-bug--0417.md § Bug 5 for the
 * full root-cause chain. Do NOT change the trigger without reading that doc.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { SessionEvent } from "@src/engines/SessionCore";
import {
  focusedSubagentCellAtom,
  simulatorSubagentSessionsAtom,
  subagentPanelRevealRequestAtom,
} from "@src/store/ui/simulatorAtom";

import { useSubagentEventCounts } from "./useSubagentEventCounts";
import type { SubagentSession } from "./useSubagentSessions";
import {
  useActiveSubagentsAtCursor,
  useSubagentSessions,
} from "./useSubagentSessions";

interface UseSimulatorSubagentsOptions {
  sessionId: string;
  eventStoreVersion: number;
  currentEvent: SessionEvent | null;
}

export interface UseSimulatorSubagentsReturn {
  allSubagentSessions: SubagentSession[];
  activeSubagents: SubagentSession[];
  hasActiveSubagents: boolean;
  handleSubagentPanelClose: () => void;
}

export function useSimulatorSubagents({
  sessionId,
  eventStoreVersion,
  currentEvent,
}: UseSimulatorSubagentsOptions): UseSimulatorSubagentsReturn {
  const panelRevealRequest = useAtomValue(subagentPanelRevealRequestAtom);
  const focusedCellId = useAtomValue(focusedSubagentCellAtom);
  const [dismissedSnapshot, setDismissedSnapshot] = useState<{
    keys: string;
    reveal: number;
  } | null>(null);

  // DB query — re-triggered by eventStoreVersion (bumped on every EventStore
  // mutation, including args patches like stamp_subagent_session_id_on_parent).
  const allSubagentSessions = useSubagentSessions(
    sessionId || null,
    eventStoreVersion
  );

  // Sync to atom so SessionReplayMessages can read without prop drilling.
  // Cleanup clears the atom when ActivitySimulator unmounts so stale sessions
  // never leak into the next mounted session.
  const setSimulatorSubagentSessions = useSetAtom(
    simulatorSubagentSessionsAtom
  );
  useEffect(() => {
    setSimulatorSubagentSessions(allSubagentSessions);
    return () => {
      setSimulatorSubagentSessions([]);
    };
  }, [allSubagentSessions, setSimulatorSubagentSessions]);

  // Filter to sessions whose time-window covers the current replay cursor.
  // When no clip covers the cursor, fall back to clips that are still OPEN
  // (endedAtMs === null, i.e. running right now) so a freshly spawned
  // subagent is visible even while the main cursor lags behind its
  // startedAtMs (the spawning tool_call is filtered from the slider).
  // Closed clips deliberately do NOT resurface here — once the cursor
  // passes a clip's end, its cell retires from the monitor. The old
  // fall-back-to-everything behavior is what made cells accumulate.
  const cursorActiveSubagents = useActiveSubagentsAtCursor(
    allSubagentSessions,
    currentEvent
  );
  const openSubagents = useMemo(
    () => allSubagentSessions.filter((sub) => sub.endedAtMs === null),
    [allSubagentSessions]
  );
  // A subagent the user explicitly navigated to (clicked the chat block's
  // locate arrow) must surface even when the replay cursor doesn't land inside
  // its clip window. The spawning tool_call is filtered out of the simulator
  // event list, so seeking the cursor to it resolves to a neighbour outside
  // the window — focus is the authoritative "show this one" signal, so honour
  // it directly instead of depending on the (substituted) cursor event.
  const focusedSubagent = useMemo(
    () =>
      focusedCellId
        ? (allSubagentSessions.find((sub) => sub.sessionId === focusedCellId) ??
          null)
        : null,
    [allSubagentSessions, focusedCellId]
  );
  const baseSubagents =
    cursorActiveSubagents.length > 0 ? cursorActiveSubagents : openSubagents;
  const cursorOrAllSubagents = useMemo(() => {
    if (!focusedSubagent) return baseSubagents;
    if (
      baseSubagents.some((sub) => sub.sessionId === focusedSubagent.sessionId)
    )
      return baseSubagents;
    return [focusedSubagent, ...baseSubagents];
  }, [baseSubagents, focusedSubagent]);

  // Subscribe (count-only) to every subagent's EventStore so we can rank
  // "has activity" rows ahead of "no activity" rows BEFORE the consumer
  // (SubagentPipCard / BackgroundTasksApp) paginates the list. Without
  // this, the DB-status ordering from useSubagentSessions is the only
  // signal — and a subagent with status="running" but zero events still
  // lands on page 1, pushing a populated subagent onto page 2.
  const subagentCountMap = useSubagentEventCounts(cursorOrAllSubagents);

  const activeSubagents = useMemo(() => {
    if (cursorOrAllSubagents.length <= 1) return cursorOrAllSubagents;
    // Stable sort: rows with chatEvents > 0 first, zero-event rows last.
    // Within each group preserve original index so a single count change
    // doesn't reshuffle unrelated cells.
    const indexById = new Map(
      cursorOrAllSubagents.map((sub, index) => [sub.sessionId, index])
    );
    const ranked = cursorOrAllSubagents.slice();
    ranked.sort((left, right) => {
      const leftHas = (subagentCountMap.get(left.sessionId) ?? 0) > 0;
      const rightHas = (subagentCountMap.get(right.sessionId) ?? 0) > 0;
      if (leftHas === rightHas) {
        return (
          (indexById.get(left.sessionId) ?? 0) -
          (indexById.get(right.sessionId) ?? 0)
        );
      }
      return leftHas ? -1 : 1;
    });
    return ranked;
  }, [cursorOrAllSubagents, subagentCountMap]);

  const activeSubagentKeys = activeSubagents.map((sub) => sub.key).join(",");

  const handleSubagentPanelClose = useCallback(() => {
    setDismissedSnapshot({
      keys: activeSubagentKeys,
      reveal: panelRevealRequest,
    });
  }, [activeSubagentKeys, panelRevealRequest]);

  // Panel re-opens when either the key set or the reveal counter changes.
  const isPanelDismissed =
    dismissedSnapshot !== null &&
    dismissedSnapshot.keys === activeSubagentKeys &&
    dismissedSnapshot.reveal === panelRevealRequest;

  const hasActiveSubagents = activeSubagents.length > 0 && !isPanelDismissed;

  return {
    allSubagentSessions,
    activeSubagents,
    hasActiveSubagents,
    handleSubagentPanelClose,
  };
}
