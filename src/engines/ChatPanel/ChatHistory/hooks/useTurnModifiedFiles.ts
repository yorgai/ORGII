import { useEffect, useState } from "react";

import { loadTurnIndex } from "@src/engines/SessionCore/storage/cacheAdapter";
import type { TurnModifiedFile } from "@src/engines/SessionCore/storage/sqliteCache";

/**
 * Load the per-round modified-file lists for a session from the turn index
 * (`session_turns.modified_files_json`) and expose them keyed by turnId.
 *
 * `reloadKey` controls refetch cadence: callers bump it when the active
 * session changes, a new round appears, or the agent transitions to idle —
 * NOT on every streamed event, so the backend freshness gate isn't hammered
 * mid-stream.
 */
export function useTurnModifiedFiles(
  sessionId: string | null,
  reloadKey: string
): Map<string, TurnModifiedFile[]> {
  const [filesByTurnId, setFilesByTurnId] = useState<
    Map<string, TurnModifiedFile[]>
  >(() => new Map());

  useEffect(() => {
    let cancelled = false;

    // No active session: clear asynchronously (avoids a synchronous
    // setState in the effect body). Lookups are keyed by turnId, so even a
    // momentarily stale map can't surface another session's footers.
    if (!sessionId) {
      Promise.resolve().then(() => {
        if (!cancelled) setFilesByTurnId(new Map());
      });
      return () => {
        cancelled = true;
      };
    }

    loadTurnIndex(sessionId)
      .then((turns) => {
        if (cancelled) return;
        const next = new Map<string, TurnModifiedFile[]>();
        for (const turn of turns) {
          if (turn.modifiedFiles && turn.modifiedFiles.length > 0) {
            next.set(turn.turnId, turn.modifiedFiles);
          }
        }
        setFilesByTurnId(next);
      })
      .catch(() => {
        if (!cancelled) setFilesByTurnId(new Map());
      });

    return () => {
      cancelled = true;
    };
    // reloadKey already encodes sessionId; listed explicitly for clarity.
  }, [sessionId, reloadKey]);

  return filesByTurnId;
}
