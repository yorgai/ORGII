import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { getSessionFiles } from "@src/api/tauri/agent/session";
import type { SessionFileRecord } from "@src/api/tauri/agent/types";
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session";
import type { Session } from "@src/store/session/sessionAtom/types";
import type { GitFile } from "@src/types/git/types";

const logger = createLogger("SourceControlSessionAttribution");

const MAX_CONCURRENT_SESSION_FILE_REQUESTS = 4;
const cachedSessionFiles = new Map<string, Promise<SessionFileRecord[]>>();
const EMPTY_PATH_TO_SESSION_IDS = new Map<string, Set<string>>();

export const SOURCE_CONTROL_OTHER_SESSIONS_FILTER = "other" as const;

export interface SourceControlSessionOptionData {
  sessionId: string;
  label: string;
  count: number;
}

interface UseSourceControlSessionAttributionParams {
  files: GitFile[];
  repoPath: string;
}

interface UseSourceControlSessionAttributionResult {
  attributedFiles: GitFile[];
  sessionOptions: SourceControlSessionOptionData[];
  otherCount: number;
}

interface LoadedSessionAttribution {
  key: string;
  pathToSessionIds: Map<string, Set<string>>;
}

function normalizePathForAttribution(
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.replace(/\/+$/g, "")
    : normalized;
}

function joinPath(root: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${root}/${path}`;
}

function getAttributionPathCandidates(
  file: GitFile,
  repoPath: string
): Set<string> {
  const candidates = new Set<string>();
  const roots = [file.repoRoot, repoPath]
    .map(normalizePathForAttribution)
    .filter((root): root is string => Boolean(root));
  const paths = [file.path, file.original_path]
    .map(normalizePathForAttribution)
    .filter((path): path is string => Boolean(path));

  for (const path of paths) {
    candidates.add(path);
    for (const root of roots) {
      candidates.add(joinPath(root, path));
      if (path.startsWith(`${root}/`)) {
        candidates.add(path.slice(root.length + 1));
      }
    }
  }

  return candidates;
}

function getSessionFilePathCandidates(
  record: SessionFileRecord,
  session: Session,
  repoPath: string
): Set<string> {
  const candidates = new Set<string>();
  const recordPath = normalizePathForAttribution(record.path);
  if (!recordPath) return candidates;

  const roots = [session.worktreePath, session.repoPath, repoPath]
    .map(normalizePathForAttribution)
    .filter((root): root is string => Boolean(root));

  candidates.add(recordPath);
  for (const root of roots) {
    candidates.add(joinPath(root, recordPath));
    if (recordPath.startsWith(`${root}/`)) {
      candidates.add(recordPath.slice(root.length + 1));
    }
  }

  return candidates;
}

function getSessionLabel(session: Session): string {
  return (
    session.name ||
    session.agentDisplayName ||
    session.user_input ||
    session.worktreeBranch ||
    session.session_id.slice(0, 8)
  );
}

function getCandidateSessions(
  sessions: Session[],
  files: GitFile[],
  repoPath: string
): Session[] {
  const normalizedRepoPath = normalizePathForAttribution(repoPath);
  const changedRepoRoots = new Set(
    files
      .map((file) => normalizePathForAttribution(file.repoRoot))
      .filter((root): root is string => Boolean(root))
  );

  return sessions.filter((session) => {
    const sessionRepoPath = normalizePathForAttribution(session.repoPath);
    const sessionWorktreePath = normalizePathForAttribution(
      session.worktreePath
    );
    return (
      Boolean(session.session_id) &&
      ((normalizedRepoPath !== null &&
        sessionRepoPath === normalizedRepoPath) ||
        (sessionWorktreePath !== null &&
          changedRepoRoots.has(sessionWorktreePath)))
    );
  });
}

function getCachedSessionFiles(
  sessionId: string
): Promise<SessionFileRecord[]> {
  const existing = cachedSessionFiles.get(sessionId);
  if (existing) return existing;

  const request = getSessionFiles(sessionId).catch((error: unknown) => {
    cachedSessionFiles.delete(sessionId);
    throw error;
  });
  cachedSessionFiles.set(sessionId, request);
  return request;
}

async function loadSessionFileEntries(
  candidateSessions: Session[],
  repoPath: string,
  cancelled: () => boolean
): Promise<Map<string, Set<string>>> {
  const pathToSessionIds = new Map<string, Set<string>>();
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!cancelled()) {
      const session = candidateSessions[nextIndex];
      nextIndex += 1;
      if (!session) return;

      try {
        const records = await getCachedSessionFiles(session.session_id);
        if (cancelled()) return;

        for (const record of records) {
          const candidates = getSessionFilePathCandidates(
            record,
            session,
            repoPath
          );
          for (const path of candidates) {
            const sessionIds = pathToSessionIds.get(path) ?? new Set<string>();
            sessionIds.add(session.session_id);
            pathToSessionIds.set(path, sessionIds);
          }
        }
      } catch (error: unknown) {
        logger.warn("Failed to load session files:", error, {
          sessionId: session.session_id,
        });
      }
    }
  }

  const workerCount = Math.min(
    MAX_CONCURRENT_SESSION_FILE_REQUESTS,
    candidateSessions.length
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return pathToSessionIds;
}

export function useSourceControlSessionAttribution({
  files,
  repoPath,
}: UseSourceControlSessionAttributionParams): UseSourceControlSessionAttributionResult {
  const sessions = useAtomValue(sessionsAtom);
  const candidateSessions = useMemo(
    () => getCandidateSessions(sessions, files, repoPath),
    [files, repoPath, sessions]
  );
  const attributionKey = useMemo(
    () =>
      `${repoPath}::${candidateSessions
        .map((session) => session.session_id)
        .sort()
        .join("|")}`,
    [candidateSessions, repoPath]
  );
  const [loadedAttribution, setLoadedAttribution] =
    useState<LoadedSessionAttribution | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (files.length === 0 || candidateSessions.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    void loadSessionFileEntries(
      candidateSessions,
      repoPath,
      () => cancelled
    ).then((nextPathToSessionIds) => {
      if (!cancelled) {
        setLoadedAttribution({
          key: attributionKey,
          pathToSessionIds: nextPathToSessionIds,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attributionKey, candidateSessions, files.length, repoPath]);

  const pathToSessionIds =
    loadedAttribution?.key === attributionKey
      ? loadedAttribution.pathToSessionIds
      : EMPTY_PATH_TO_SESSION_IDS;

  return useMemo(() => {
    const attributedFiles = files.map((file) => {
      const matchedSessionIds = new Set<string>();
      const candidates = getAttributionPathCandidates(file, repoPath);

      for (const path of candidates) {
        const sessionIds = pathToSessionIds.get(path);
        if (!sessionIds) continue;
        for (const sessionId of sessionIds) {
          matchedSessionIds.add(sessionId);
        }
      }

      const sessionIds = Array.from(matchedSessionIds).sort();
      const sourceSessionId =
        sessionIds.length === 1 ? sessionIds[0] : undefined;

      return {
        ...file,
        sourceSessionId,
        sessionIds,
      };
    });

    const sessionCounts = attributedFiles.reduce((counts, file) => {
      if (!file.sourceSessionId) return counts;
      return new Map(counts).set(
        file.sourceSessionId,
        (counts.get(file.sourceSessionId) ?? 0) + 1
      );
    }, new Map<string, number>());
    const otherCount = attributedFiles.filter(
      (file) => !file.sourceSessionId
    ).length;

    const sessionOptions = candidateSessions
      .map((session) => ({
        sessionId: session.session_id,
        label: getSessionLabel(session),
        count: sessionCounts.get(session.session_id) ?? 0,
      }))
      .filter((option) => option.count > 0)
      .sort(
        (first, second) =>
          second.count - first.count || first.label.localeCompare(second.label)
      );

    return {
      attributedFiles,
      sessionOptions,
      otherCount,
    };
  }, [candidateSessions, files, pathToSessionIds, repoPath]);
}
