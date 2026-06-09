import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getGitCommits } from "@src/api/http/git";
import type { GitCommitInfo } from "@src/api/http/git/types";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store/EventStoreProxy";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { KanbanTask } from "@src/features/KanbanBoard";
import type { Session } from "@src/store/session";
import { sessionMapAtom } from "@src/store/session/sessionAtom/atoms";

import type { DiaryTimelineDisplayMode } from "../../config";
import { buildDiaryDaySummary } from "../../utils/diaryUtils";
import DiaryPanel from "../DiaryPanel";

export interface DiaryViewProps {
  tasks: KanbanTask[];
  date: Date;
  displayMode: DiaryTimelineDisplayMode;
  onTaskClick?: (task: KanbanTask) => void;
}

function getDiarySessionIds(tasks: KanbanTask[]): string[] {
  return Array.from(
    new Set(
      tasks
        .map((task) => task.session_id)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    )
  );
}

function resolveRepoDisplayName(
  repoPath: string,
  sessionIds: string[],
  sessionMap: ReadonlyMap<string, Session>
): string {
  for (const sessionId of sessionIds) {
    const session = sessionMap.get(sessionId);
    if (!session) continue;

    const sessionRepoPath = session.worktreePath ?? session.repoPath;
    if (sessionRepoPath === repoPath && session.repo_name) {
      return session.repo_name;
    }
  }

  const normalizedPath = repoPath.replace(/\/$/, "");
  const pathSegments = normalizedPath.split(/[/\\]/);
  return pathSegments[pathSegments.length - 1] || repoPath;
}

function getCommitsRowTitle(
  repoPaths: string[],
  sessionIds: string[],
  sessionMap: ReadonlyMap<string, Session>,
  translate: TFunction<"sessions">
): string {
  if (repoPaths.length === 0) {
    return translate("opsControl.diary.commits");
  }

  const repoNames = Array.from(
    new Set(
      repoPaths.map((repoPath) =>
        resolveRepoDisplayName(repoPath, sessionIds, sessionMap)
      )
    )
  );

  if (repoNames.length === 1) {
    return translate("opsControl.diary.commitsTo", { repo: repoNames[0] });
  }

  return translate("opsControl.diary.commitsToMultiple", {
    repos: repoNames.join(", "),
  });
}

function getDiaryRepoPaths(
  sessionIds: string[],
  sessionMap: ReadonlyMap<string, Session>
): string[] {
  return Array.from(
    new Set(
      sessionIds
        .map((sessionId) => {
          const session = sessionMap.get(sessionId);
          return session?.worktreePath ?? session?.repoPath;
        })
        .filter((repoPath): repoPath is string => Boolean(repoPath))
    )
  );
}

const DiaryView: React.FC<DiaryViewProps> = ({
  tasks,
  date,
  displayMode,
  onTaskClick,
}) => {
  const { t } = useTranslation("sessions");
  const sessionMap = useAtomValue(sessionMapAtom);
  const sessionIds = useMemo(() => getDiarySessionIds(tasks), [tasks]);
  const repoPaths = useMemo(
    () => getDiaryRepoPaths(sessionIds, sessionMap),
    [sessionIds, sessionMap]
  );
  const repoPathKey = useMemo(() => repoPaths.join("\u0000"), [repoPaths]);
  const commitsRowTitle = useMemo(
    () => getCommitsRowTitle(repoPaths, sessionIds, sessionMap, t),
    [repoPaths, sessionIds, sessionMap, t]
  );
  const snapshotEventsBySessionId = useMemo(() => {
    const entries: Array<readonly [string, SessionEvent[]]> = [];

    for (const sessionId of sessionIds) {
      const snapshot = eventStoreProxy.getLatestSessionSnapshot(sessionId);
      if (!snapshot) continue;

      const events =
        "events" in snapshot ? snapshot.events : snapshot.chatEvents;
      entries.push([sessionId, events] as const);
    }

    return new Map(entries);
  }, [sessionIds]);
  const [loadedEventsBySessionId, setLoadedEventsBySessionId] = useState<
    ReadonlyMap<string, SessionEvent[]>
  >(() => new Map());
  const eventsBySessionId = useMemo(() => {
    const sessionIdSet = new Set(sessionIds);
    const entries: Array<readonly [string, SessionEvent[]]> = [];

    for (const sessionId of sessionIds) {
      const events =
        snapshotEventsBySessionId.get(sessionId) ??
        loadedEventsBySessionId.get(sessionId);
      if (events && sessionIdSet.has(sessionId)) {
        entries.push([sessionId, events] as const);
      }
    }

    return new Map(entries);
  }, [loadedEventsBySessionId, sessionIds, snapshotEventsBySessionId]);
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    const sessionIdSet = new Set(sessionIds);
    const missingSessionIds = sessionIds.filter(
      (sessionId) => !snapshotEventsBySessionId.has(sessionId)
    );

    for (const sessionId of missingSessionIds) {
      void (async () => {
        try {
          await eventStoreProxy.loadFromCache(sessionId);
          const events = await eventStoreProxy.getEvents(sessionId);
          if (cancelled) return;

          setLoadedEventsBySessionId((current) => {
            if (!sessionIdSet.has(sessionId)) return current;
            const next = new Map(current);
            next.set(sessionId, events);
            return next;
          });
        } catch (error: unknown) {
          console.warn("[DiaryView] failed to load session events", error);
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [sessionIds, snapshotEventsBySessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadCommits(): Promise<void> {
      const currentRepoPaths = repoPathKey
        .split("\u0000")
        .filter((repoPath): repoPath is string => Boolean(repoPath));
      if (currentRepoPaths.length === 0) {
        setCommits([]);
        return;
      }

      const entries = await Promise.all(
        currentRepoPaths.map(async (repoPath) => {
          const result = await getGitCommits({
            repo_id: repoPath,
            repo_path: repoPath,
            limit: 200,
          });
          return result?.commits ?? [];
        })
      );

      if (!cancelled) {
        const commitMap = new Map<string, GitCommitInfo>();
        for (const repoCommits of entries) {
          for (const commit of repoCommits) {
            commitMap.set(commit.sha, commit);
          }
        }
        setCommits(Array.from(commitMap.values()));
      }
    }

    loadCommits().catch((error: unknown) => {
      console.warn("[DiaryView] failed to load git commits", error);
      if (!cancelled) setCommits([]);
    });

    return () => {
      cancelled = true;
    };
  }, [repoPathKey]);

  const summary = useMemo(
    () =>
      buildDiaryDaySummary(tasks, date, new Date(), eventsBySessionId, commits),
    [tasks, date, eventsBySessionId, commits]
  );

  return (
    <div className="h-full min-h-0 w-full overflow-hidden">
      <DiaryPanel
        summary={summary}
        displayMode={displayMode}
        commitsRowTitle={commitsRowTitle}
        onEventClick={(taskId) => {
          const task = tasks.find((candidate) => candidate.id === taskId);
          if (task) onTaskClick?.(task);
        }}
      />
    </div>
  );
};

export default DiaryView;
