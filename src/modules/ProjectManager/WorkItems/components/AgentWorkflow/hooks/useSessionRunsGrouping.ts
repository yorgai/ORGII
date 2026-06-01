import { useMemo } from "react";

import type { LinkedSession } from "@src/api/http/project";

import type { SessionRun } from "../types";

interface UseSessionRunsGroupingOptions {
  linkedSessions: LinkedSession[];
  activeAgentSessionId?: string | null;
}

export function useSessionRunsGrouping(options: UseSessionRunsGroupingOptions) {
  const { linkedSessions, activeAgentSessionId } = options;

  const cycleCount = useMemo(
    () =>
      linkedSessions.filter(
        (ls) => ls.agent_role === "review" && ls.session_id !== "pending"
      ).length,
    [linkedSessions]
  );

  const resolvedActiveSessionId = useMemo(() => {
    if (activeAgentSessionId) return activeAgentSessionId;
    const linked = linkedSessions.find(
      (ls) => ls.status === "running" && ls.session_id !== "pending"
    );
    return linked?.session_id ?? null;
  }, [activeAgentSessionId, linkedSessions]);

  const { sessionRuns, subAgentsByParent } = useMemo(() => {
    const topLevel = linkedSessions.filter((ls) => !ls.parent_session_id);
    const subAgentSessions = linkedSessions.filter(
      (ls) => !!ls.parent_session_id
    );

    const roleCounts: Record<string, number> = {};
    const runs: SessionRun[] = topLevel
      .filter(
        (ls) =>
          ls.session_id !== "pending" || ls.session_id === activeAgentSessionId
      )
      .map((ls) => {
        const role = ls.agent_role ?? "sde";
        roleCounts[role] = (roleCounts[role] ?? 0) + 1;
        const effectiveId =
          ls.session_id === "pending" && activeAgentSessionId
            ? activeAgentSessionId
            : ls.session_id;
        const isActive =
          effectiveId === resolvedActiveSessionId && ls.status === "running";
        return {
          effectiveId,
          role,
          runNumber: roleCounts[role],
          isActive,
          session_id: ls.session_id,
          status: ls.status,
        };
      });

    const grouped = new Map<string, LinkedSession[]>();
    for (const sub of subAgentSessions) {
      const parentId = sub.parent_session_id!;
      const existing = grouped.get(parentId) ?? [];
      existing.push(sub);
      grouped.set(parentId, existing);
    }

    return { sessionRuns: runs, subAgentsByParent: grouped };
  }, [linkedSessions, activeAgentSessionId, resolvedActiveSessionId]);

  const hasRuns = sessionRuns.some((run) => run.effectiveId !== "pending");

  return {
    cycleCount,
    resolvedActiveSessionId,
    sessionRuns,
    subAgentsByParent,
    hasRuns,
  };
}
