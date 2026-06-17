import { useCallback, useEffect, useMemo, useState } from "react";

import {
  analyzeOrgtrackSessions,
  getOrgtrackSessionSummaries,
} from "@src/api/tauri/lineage";
import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import type { KanbanTaskOrgtrackMetadata } from "@src/features/KanbanBoard/types";
import { createLogger } from "@src/hooks/logger";
import { type Session, loadSessions } from "@src/store/session";
import {
  isClaudeCodeHistorySession,
  isCodexAppSession,
  isCursorIdeSession,
} from "@src/util/session/sessionDispatch";

const logger = createLogger("SessionOrgtrackMetadata");

function hasSourceImpactFastPath(session: Session): boolean {
  return (
    session.category === DISPATCH_CATEGORY.RUST_AGENT ||
    isCursorIdeSession(session.session_id) ||
    isCodexAppSession(session.session_id) ||
    isClaudeCodeHistorySession(session.session_id)
  );
}

function metadataFromSessionImpact(
  session: Session
): KanbanTaskOrgtrackMetadata | undefined {
  if (!hasSourceImpactFastPath(session)) return undefined;

  const touchedFileCount = session.touchedFiles?.length ?? 0;
  const filesChanged =
    session.filesChanged && session.filesChanged > 0
      ? session.filesChanged
      : touchedFileCount;
  const linesAdded = session.linesAdded ?? 0;
  const linesRemoved = session.linesRemoved ?? 0;
  if (filesChanged === 0 && linesAdded === 0 && linesRemoved === 0) {
    return undefined;
  }

  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    relatedCommits: 0,
    committedFiles: 0,
    committedRatePercent: 0,
    touchedFiles: session.touchedFiles,
  };
}

function isSourceImpactUnavailable(session: Session): boolean {
  return (
    hasSourceImpactFastPath(session) && !metadataFromSessionImpact(session)
  );
}

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
  unavailableSessionIds: Set<string>;
  analyzingSessionIds: Set<string>;
  analyzeSession: (
    session: Session,
    options?: { rebuild?: boolean }
  ) => Promise<void>;
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

  const analyzeSession = useCallback(
    async (session: Session, options: { rebuild?: boolean } = {}) => {
      if (metadataFromSessionImpact(session)) {
        await loadSessions({ forceRefresh: true });
        setRefreshNonce((current) => current + 1);
        return;
      }

      setAnalyzingSessionIds((current) => {
        const next = new Set(current);
        next.add(session.session_id);
        return next;
      });
      try {
        await analyzeOrgtrackSessions({
          workspacePath: session.repoPath || session.worktreePath,
          sessionId: session.session_id,
          rebuild: options.rebuild ?? true,
        });
        await loadSessions({ forceRefresh: true });
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
    },
    []
  );

  const metadataBySessionId = useMemo(() => {
    const nextMetadata = metadataFromSummaries(summaries);
    for (const session of sessions) {
      const sourceImpactMetadata = metadataFromSessionImpact(session);
      if (sourceImpactMetadata) {
        nextMetadata.set(session.session_id, sourceImpactMetadata);
      }
    }
    return nextMetadata;
  }, [sessions, summaries]);

  const unavailableSessionIds = useMemo(() => {
    return new Set(
      sessions
        .filter((session) => isSourceImpactUnavailable(session))
        .map((session) => session.session_id)
    );
  }, [sessions]);

  return useMemo(
    () => ({
      metadataBySessionId,
      unavailableSessionIds,
      analyzingSessionIds,
      analyzeSession,
    }),
    [
      analyzeSession,
      analyzingSessionIds,
      metadataBySessionId,
      unavailableSessionIds,
    ]
  );
}
