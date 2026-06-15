import { useEffect, useMemo, useState } from "react";

import { getOrgtrackSessionSummaries } from "@src/api/tauri/lineage";
import type { CoreSessionSummary } from "@src/api/tauri/lineage";
import type { KanbanTaskOrgtrackMetadata } from "@src/features/KanbanBoard/types";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session";

const logger = createLogger("SessionOrgtrackMetadata");

function workspacePathsForSession(session: Session): string[] {
  return [session.repoPath, session.worktreePath].filter(
    (path): path is string => Boolean(path)
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

function hasImpactMetadata(metadata: KanbanTaskOrgtrackMetadata): boolean {
  return (
    metadata.filesChanged > 0 ||
    metadata.linesAdded > 0 ||
    metadata.linesRemoved > 0 ||
    metadata.relatedCommits > 0 ||
    metadata.committedFiles > 0 ||
    metadata.committedRatePercent > 0
  );
}

function metadataFromSession(
  session: Session
): KanbanTaskOrgtrackMetadata | undefined {
  const filesChanged = session.filesChanged ?? 0;
  const linesAdded = session.linesAdded ?? 0;
  const linesRemoved = session.linesRemoved ?? 0;
  const metadata = {
    filesChanged,
    linesAdded,
    linesRemoved,
    relatedCommits: 0,
    committedFiles: 0,
    committedRatePercent: 0,
  };

  return hasImpactMetadata(metadata) ? metadata : undefined;
}

export function useSessionOrgtrackMetadata(
  sessions: readonly Session[]
): Map<string, KanbanTaskOrgtrackMetadata> {
  const workspacePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const session of sessions) {
      for (const workspacePath of workspacePathsForSession(session)) {
        paths.add(workspacePath);
      }
    }
    return [...paths].sort();
  }, [sessions]);
  const [summariesByWorkspacePath, setSummariesByWorkspacePath] = useState<
    Map<string, CoreSessionSummary[]>
  >(new Map());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (workspacePaths.length === 0) {
        await Promise.resolve();
        if (!cancelled) {
          setSummariesByWorkspacePath(new Map());
        }
        return;
      }

      const entries = await Promise.all(
        workspacePaths.map(async (workspacePath) => {
          try {
            return [
              workspacePath,
              await getOrgtrackSessionSummaries({ workspacePath }),
            ] as const;
          } catch (err) {
            logger.warn("failed to load orgtrack core summaries", {
              workspacePath,
              err,
            });
            return [workspacePath, []] as const;
          }
        })
      );
      if (!cancelled) {
        setSummariesByWorkspacePath(new Map(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspacePaths]);

  return useMemo(() => {
    const metadataBySessionId = new Map<string, KanbanTaskOrgtrackMetadata>();
    for (const session of sessions) {
      const metadata = metadataFromSession(session);
      if (metadata) {
        metadataBySessionId.set(session.session_id, metadata);
      }
    }
    for (const summaries of summariesByWorkspacePath.values()) {
      for (const [sessionId, metadata] of metadataFromSummaries(summaries)) {
        if (
          hasImpactMetadata(metadata) ||
          !metadataBySessionId.has(sessionId)
        ) {
          metadataBySessionId.set(sessionId, metadata);
        }
      }
    }
    return metadataBySessionId;
  }, [sessions, summariesByWorkspacePath]);
}
