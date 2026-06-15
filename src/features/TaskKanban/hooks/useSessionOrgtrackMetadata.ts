import { useCallback, useEffect, useMemo, useState } from "react";

import {
  analyzeOrgtrackSessions,
  getOrgtrackSessionSummaries,
} from "@src/api/tauri/lineage";
import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import type { KanbanTaskOrgtrackMetadata } from "@src/features/KanbanBoard/types";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session";

const logger = createLogger("SessionOrgtrackMetadata");

function metadataFromSummaries(
  summaries: readonly CoreSessionSummary[]
): Map<string, KanbanTaskOrgtrackMetadata> {
  const metadataBySessionId = new Map<string, KanbanTaskOrgtrackMetadata>();
  for (const summary of summaries) {
    metadataBySessionId.set(summary.sessionId, {
      filesChanged: summary.filesChanged,
      linesAdded: summary.linesAdded,
      linesRemoved: summary.linesRemoved,
      relatedCommits: summary.relatedCommits,
      committedFiles: Math.round(
        (summary.filesChanged * summary.committedRatePercent) / 100
      ),
      committedRatePercent: summary.committedRatePercent,
    });
  }
  return metadataBySessionId;
}

export interface SessionOrgtrackMetadataState {
  metadataBySessionId: Map<string, KanbanTaskOrgtrackMetadata>;
  analyzingSessionIds: Set<string>;
  analyzeSession: (session: Session) => Promise<void>;
}

export function useSessionOrgtrackMetadata(
  sessions: readonly Session[]
): SessionOrgtrackMetadataState {
  const [summaries, setSummaries] = useState<CoreSessionSummary[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [analyzingSessionIds, setAnalyzingSessionIds] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (sessions.length === 0) {
        await Promise.resolve();
        if (!cancelled) {
          setSummaries([]);
        }
        return;
      }

      try {
        const nextSummaries = await getOrgtrackSessionSummaries();
        if (!cancelled) {
          setSummaries(nextSummaries);
        }
      } catch (err) {
        logger.warn("failed to load orgtrack core summaries", { err });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshNonce, sessions.length]);

  const analyzeSession = useCallback(async (session: Session) => {
    setAnalyzingSessionIds((current) => {
      const next = new Set(current);
      next.add(session.session_id);
      return next;
    });
    try {
      await analyzeOrgtrackSessions({
        workspacePath: session.repoPath || session.worktreePath,
        sessionId: session.session_id,
        rebuild: true,
      });
      setRefreshNonce((current) => current + 1);
    } catch (err) {
      logger.warn("failed to analyze orgtrack session", {
        err,
        sessionId: session.session_id,
      });
    } finally {
      setAnalyzingSessionIds((current) => {
        const next = new Set(current);
        next.delete(session.session_id);
        return next;
      });
    }
  }, []);

  const metadataBySessionId = useMemo(
    () => metadataFromSummaries(summaries),
    [summaries]
  );

  return useMemo(
    () => ({ metadataBySessionId, analyzingSessionIds, analyzeSession }),
    [analyzeSession, analyzingSessionIds, metadataBySessionId]
  );
}
