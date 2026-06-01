/**
 * WorktreeCompareWindow
 *
 * Standalone Tauri window for best-of-N worktree comparison.
 * Shows multiple worktree session diffs in tabs so the user can review
 * and pick the best result before merging.
 *
 * URL param: `sessionIds` — comma-separated list of session IDs.
 * Optional: `repoPath` — shared repo root for file path resolution.
 */
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import SessionDiffWindow from "@src/windows/SessionDiffWindow";

interface WorktreeCompareWindowProps {
  sessionIds: string[];
  repoPath?: string;
}

const WorktreeCompareWindow: React.FC<WorktreeCompareWindowProps> = ({
  sessionIds,
  repoPath,
}) => {
  const { t } = useTranslation("sessions");
  const [activeIdx, setActiveIdx] = useState(0);

  if (sessionIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-text-3">
        {t("worktreeCompare.noSessions")}
      </div>
    );
  }

  const safeIdx = activeIdx < sessionIds.length ? activeIdx : 0;
  const activeId = sessionIds[safeIdx] ?? sessionIds[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-1">
      {/* Tab bar */}
      <div className="flex flex-shrink-0 items-center gap-0 overflow-x-auto border-b border-border-2 scrollbar-hide">
        <span className="shrink-0 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-text-3">
          {t("worktreeCompare.title")}
        </span>
        <div className="flex items-center gap-0">
          {sessionIds.map((id, idx) => {
            const isActive = idx === safeIdx;
            const shortId = id.length > 12 ? `…${id.slice(-10)}` : id;
            return (
              <button
                key={id}
                onClick={() => setActiveIdx(idx)}
                title={id}
                className={`shrink-0 border-b-2 px-4 py-2 text-[12px] transition-colors ${
                  isActive
                    ? "border-primary-6 text-primary-6"
                    : "border-transparent text-text-3 hover:text-text-1"
                }`}
              >
                {t("worktreeCompare.sessionTab", {
                  n: idx + 1,
                  id: shortId,
                })}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active session diff */}
      <div className="min-h-0 flex-1">
        <SessionDiffWindow
          key={activeId}
          sessionId={activeId}
          repoPath={repoPath}
          hasWorktree
        />
      </div>
    </div>
  );
};

export default WorktreeCompareWindow;
