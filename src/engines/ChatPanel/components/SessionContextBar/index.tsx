/**
 * SessionContextBar
 *
 * Thin read-only header bar showing the session's repo and branch context.
 * Shown at the top of an active session's chat when the session has a
 * `repoPath`. When the session runs in a worktree, the worktree branch is
 * displayed as a static badge — the runner is locked at the agent-core
 * layer once the worktree is created and cannot be switched in the UI.
 */
import { useAtomValue } from "jotai";
import { GitFork, Monitor } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import { sessionByIdAtom } from "@src/store/session/sessionAtom";
import { formatBranchLabel } from "@src/util/git/branchLabel";
import { basename } from "@src/util/path";

// ── Sub-components ────────────────────────────────────────────────────────────

interface BarPillProps {
  label: string;
  icon?: React.ReactNode;
  dimmed?: boolean;
}

const BarPill: React.FC<BarPillProps> = ({ label, icon, dimmed }) => (
  <span
    className={`inline-flex h-[22px] max-w-[160px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium transition-colors ${
      dimmed ? "text-text-3" : "text-text-2"
    }`}
  >
    {icon}
    <span className="truncate">{label}</span>
  </span>
);

interface WorktreePillProps {
  branch: string;
}

// WorktreePill is display-only: once a session has a persisted worktreePath,
// the agent-core layer has already isolated the process and the runner cannot
// be switched back. We show the branch name as a static badge with a tooltip
// rather than a fake dropdown that pretends to offer a choice.
const WorktreePill: React.FC<WorktreePillProps> = ({ branch }) => {
  const { t } = useTranslation("sessions");

  return (
    <span
      title={t("creator.contextBar.lockedHint")}
      className="inline-flex h-[22px] max-w-[200px] items-center gap-1 truncate rounded px-1.5 text-[11px] font-medium text-primary-6"
    >
      <GitFork size={11} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const SessionContextBar: React.FC = memo(() => {
  const { sessionId } = useSessionId();
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));

  const repoPath = session?.repoPath;
  const worktreePath = session?.worktreePath;
  const worktreeBranch = session?.worktreeBranch;
  const sessionBranch = session?.branch;
  const baseBranch = session?.baseBranch;

  if (!sessionId || !repoPath) return null;

  const repoLabel = basename(repoPath);
  const branchLabel =
    formatBranchLabel(sessionBranch) || formatBranchLabel(baseBranch);
  const worktreeLabel = formatBranchLabel(worktreeBranch);

  return (
    <div className="flex h-[32px] shrink-0 items-center gap-0.5 border-b border-border-1 px-3">
      {/* Repo name */}
      <BarPill
        label={repoLabel}
        icon={
          <Monitor
            size={11}
            strokeWidth={1.75}
            className="shrink-0 text-text-3"
          />
        }
      />

      {/* Separator */}
      {(branchLabel || worktreeLabel) && (
        <span className="mx-0.5 text-[11px] text-text-4">/</span>
      )}

      {/* Base branch */}
      {branchLabel && !worktreeLabel && <BarPill label={branchLabel} dimmed />}

      {/* Worktree pill (interactive) */}
      {worktreePath && worktreeLabel && <WorktreePill branch={worktreeLabel} />}
    </div>
  );
});

SessionContextBar.displayName = "SessionContextBar";

export default SessionContextBar;
