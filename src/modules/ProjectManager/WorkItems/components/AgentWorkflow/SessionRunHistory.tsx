import { ChevronDown, ChevronRight, History } from "lucide-react";
import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LinkedSession, OrchestratorPhase } from "@src/api/http/project";

import type { AgentRole } from "../../constants";
import SessionRunCard from "./SessionRunCard";
import {
  ROLE_I18N_KEYS,
  type SessionFilesCache,
  type SessionRun,
} from "./types";

interface SessionRunHistoryProps {
  sessionRuns: SessionRun[];
  subAgentsByParent: Map<string, LinkedSession[]>;
  activeAgentSessionId?: string | null;
  activeAgentRole?: AgentRole | null;
  phase: OrchestratorPhase;
  showOnlyActive?: boolean;
  onOpenSession?: (sessionId: string) => void;
  onRefresh?: () => void;
  onSessionComplete?: (sessionId: string) => void;
}

const SessionRunHistory: React.FC<SessionRunHistoryProps> = ({
  sessionRuns,
  subAgentsByParent,
  activeAgentSessionId,
  activeAgentRole,
  phase,
  showOnlyActive = false,
  onOpenSession,
  onRefresh,
  onSessionComplete,
}) => {
  const { t } = useTranslation("projects");
  const filesCacheRef = useRef<SessionFilesCache>(new Map());
  const hasActiveSession = sessionRuns.some((run) => run.isActive);
  const defaultOpen =
    hasActiveSession ||
    phase === "sde" ||
    phase === "review" ||
    phase === "follow_up" ||
    phase === "completed";
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const handleSessionComplete = useCallback(
    (sessionId: string) => {
      onSessionComplete?.(sessionId);
      onRefresh?.();
    },
    [onRefresh, onSessionComplete]
  );

  const visibleRuns = showOnlyActive
    ? sessionRuns.filter((run) => run.isActive)
    : sessionRuns;

  const totalRuns = visibleRuns.filter(
    (run) => run.effectiveId !== "pending"
  ).length;

  return (
    <div className="mt-3">
      <button
        className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-fill-3"
        onClick={() => setIsOpen(!isOpen)}
      >
        <History size={13} className="text-text-4" />
        <span className="text-[12px] font-medium text-text-2">
          {t("common:devActivity.sessionHistory")}
        </span>
        {totalRuns > 0 && (
          <span className="rounded-full bg-fill-2 px-1.5 py-px text-[10px] font-medium text-text-3">
            {totalRuns}
          </span>
        )}
        <span className="ml-auto text-text-4">
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {isOpen && (
        <div className="mt-1.5 space-y-2">
          {activeAgentSessionId &&
            !sessionRuns.some(
              (run) => run.effectiveId === activeAgentSessionId
            ) && (
              <SessionRunCard
                key={activeAgentSessionId}
                sessionId={activeAgentSessionId}
                roleLabel={t(
                  ROLE_I18N_KEYS[activeAgentRole ?? phase] ??
                    ROLE_I18N_KEYS.coding
                )}
                runNumber={1}
                status="running"
                isActive={true}
                onOpenSession={onOpenSession}
                onSessionComplete={() =>
                  handleSessionComplete(activeAgentSessionId)
                }
                onSubAgentChange={onRefresh}
                filesCache={filesCacheRef}
              />
            )}
          {visibleRuns.map((run) => {
            if (run.effectiveId === "pending") return null;
            const roleLabel = t(ROLE_I18N_KEYS[run.role] ?? run.role);
            return (
              <SessionRunCard
                key={`${run.effectiveId}-${run.runNumber}`}
                sessionId={run.effectiveId}
                roleLabel={roleLabel}
                runNumber={run.runNumber}
                status={run.status}
                isActive={run.isActive}
                onOpenSession={onOpenSession}
                onSessionComplete={
                  run.isActive
                    ? () => handleSessionComplete(run.effectiveId)
                    : undefined
                }
                onSubAgentChange={run.isActive ? onRefresh : undefined}
                subAgentSessions={subAgentsByParent.get(run.effectiveId)}
                filesCache={filesCacheRef}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SessionRunHistory;
