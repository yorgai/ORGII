/**
 * Thin React shell for CollabSyncEngine.
 *
 * Replaces useCollaborationMetadataSync + useCollaborationSessionPush: all
 * sync logic lives in the engine; this hook only (1) starts it and (2)
 * bridges the engine's one-shot "open imported session" intent back into
 * React-land (the engine cannot call useSessionView).
 */
import { useAtom } from "jotai";
import { useEffect } from "react";

import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { collabPendingOpenSessionAtom } from "@src/store/collaboration/collabOrgsAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { collabSyncEngine } from "./CollabSyncEngine";

export function useCollabSyncEngine(): void {
  useEffect(() => {
    // Idempotent start; deliberately NOT stopped on unmount — the hook
    // mounts once in the sidebar connector, and a hot-remount must not tear
    // down the sync pipeline (the engine outlives React tree churn; that is
    // the M1 fix).
    collabSyncEngine.start(getInstrumentedStore());
    return undefined;
  }, []);

  const { openSession } = useSessionView();
  const [pendingOpenSession, setPendingOpenSession] = useAtom(
    collabPendingOpenSessionAtom
  );

  useEffect(() => {
    if (!pendingOpenSession) return;
    // One-shot: reset before navigating so re-renders can't replay it.
    setPendingOpenSession(null);
    openSession(
      pendingOpenSession.sessionId,
      pendingOpenSession.title,
      pendingOpenSession.repoPath
    );
  }, [openSession, pendingOpenSession, setPendingOpenSession]);
}
