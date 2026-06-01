import { useAtomValue } from "jotai";
import {
  Clock,
  Code2,
  Folder,
  GitBranch,
  GitCommitVertical,
  Grip,
  MessagesSquare,
  Timer,
} from "lucide-react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { isHostedKey } from "@src/api/tauri/session";
import { CLI_AGENT, type CliAgentType } from "@src/api/types/keys";
import { formatAgentType } from "@src/assets/providers";
import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { useResolvedModelLabel } from "@src/hooks/models";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import {
  currentGitStatusAtom,
  workspaceGitStatusMapAtom,
} from "@src/store/git/gitStatusAtom";
import { currentRepoAtom } from "@src/store/repo";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import {
  formatReplayDateLabel,
  toIntlLocaleTag,
} from "@src/util/data/formatters/date";
import { formatBranchLabel } from "@src/util/git/branchLabel";
import { basename } from "@src/util/path";
import {
  getDispatchCategory,
  resolveSessionIconId,
} from "@src/util/session/sessionDispatch";
import { sessionLabel } from "@src/util/session/sessionLabel";
import { formatDuration } from "@src/util/time/formatDuration";

import {
  type SessionTurnOverview,
  useSessionTurnOverview,
} from "./useSessionTurnOverview";

interface AgentSessionInfo {
  icon: React.ReactNode;
  label: string;
  textClassName?: string;
}

interface SessionHoverCardRowProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  iconClassName?: string;
}

interface SessionHoverCardContentProps {
  sessionId: string;
}

function formatCompactPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/u, "~");
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/u, "");
}

function getAgentSessionInfo(session: {
  session_id: string;
  cliAgentType?: CliAgentType | null;
  agentDisplayName?: string;
  agentIconId?: string;
}): AgentSessionInfo {
  const category = getDispatchCategory(session.session_id);

  if (session.cliAgentType) {
    return {
      icon: <ModelIcon agentType={session.cliAgentType} size={13} />,
      label: formatAgentType(session.cliAgentType),
    };
  }

  if (category === "cursor_ide") {
    return {
      icon: <ModelIcon agentType={CLI_AGENT.CURSOR} size={13} />,
      label: session.agentDisplayName || "Cursor IDE",
    };
  }

  const iconId =
    session.agentIconId || resolveSessionIconId(session.session_id);
  const AgentIcon = resolveAgentIcon(iconId);

  return {
    icon: <AgentIcon size={13} strokeWidth={1.75} />,
    label: session.agentDisplayName || "Agent",
    textClassName: "text-text-1",
  };
}

const SessionHoverCardRow: React.FC<SessionHoverCardRowProps> = ({
  icon,
  children,
  iconClassName = "text-text-3",
}) => (
  <div className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 text-[13px] leading-5 text-text-2">
    <span
      className={`mt-0.5 flex h-4 w-4 items-center justify-center ${iconClassName}`}
    >
      {icon}
    </span>
    <div className="min-w-0">{children}</div>
  </div>
);

export const SessionHoverCardContent: React.FC<SessionHoverCardContentProps> =
  memo(({ sessionId }) => {
    const { t, i18n } = useTranslation(["sessions", "common"]);
    const session = useAtomValue(sessionByIdAtom(sessionId));
    const currentRepo = useAtomValue(currentRepoAtom);
    const gitStatus = useAtomValue(currentGitStatusAtom);
    const workspaceGitStatusMap = useAtomValue(workspaceGitStatusMapAtom);
    const creatorDefaultLastModel = useValidatedLastPair();
    const turnOverview: SessionTurnOverview | null =
      useSessionTurnOverview(sessionId);
    const repoPath = session?.repoPath;

    const lastModel: LastModelSelection | null = useMemo(() => {
      if (!session) return creatorDefaultLastModel;
      const keySource = session.keySource ?? creatorDefaultLastModel?.keySource;
      const hosted = isHostedKey(keySource);
      return {
        ...creatorDefaultLastModel,
        keySource,
        cliAgentType:
          session.cliAgentType ?? creatorDefaultLastModel?.cliAgentType,
        tier: session.tier ?? creatorDefaultLastModel?.tier,
        model: hosted
          ? undefined
          : (session.model ?? creatorDefaultLastModel?.model),
        listingModel: hosted
          ? (session.model ?? creatorDefaultLastModel?.listingModel)
          : undefined,
        selectedAccountId:
          session.accountId ?? creatorDefaultLastModel?.selectedAccountId,
      };
    }, [session, creatorDefaultLastModel]);

    const { label: modelLabel, title: modelTitle } = useResolvedModelLabel(
      lastModel,
      []
    );

    if (!session) return null;

    const repoName = session.repo_name || (repoPath ? basename(repoPath) : "");
    const normalizedRepoPath = repoPath ? normalizePath(repoPath) : undefined;
    const workspaceGitStatus = normalizedRepoPath
      ? workspaceGitStatusMap.get(normalizedRepoPath)
      : undefined;
    const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri;
    const currentRepoMatchesSession =
      normalizedRepoPath &&
      currentRepoPath &&
      normalizedRepoPath === normalizePath(currentRepoPath);
    const branchLabel =
      formatBranchLabel(session.worktreeBranch) ||
      formatBranchLabel(session.branch) ||
      formatBranchLabel(session.baseBranch) ||
      formatBranchLabel(workspaceGitStatus?.current_branch) ||
      formatBranchLabel(
        currentRepoMatchesSession ? gitStatus?.current_branch : undefined
      );
    const modelIconName =
      lastModel?.listingModel || lastModel?.model || undefined;
    const modelIconAgent = lastModel?.listingModelType || undefined;
    const agentSessionInfo = getAgentSessionInfo(session);

    const title = sessionLabel(session, 160);
    const dateTimeLabelOptions = {
      todayLabel: t("common:relativeDate.today"),
      yesterdayLabel: t("common:relativeDate.yesterday"),
      locale: toIntlLocaleTag(i18n.language),
      monthStyle: "short" as const,
      withSeconds: false,
    };
    const createdLabel = formatReplayDateLabel(
      session.created_at || session.created_time,
      dateTimeLabelOptions
    );
    const updatedLabel = formatReplayDateLabel(
      session.updated_at || session.updated_time,
      dateTimeLabelOptions
    );
    const workedDurationLabel = turnOverview?.workedDurationMs
      ? formatDuration(turnOverview.workedDurationMs)
      : null;

    return (
      <div className="w-[280px] rounded-xl border border-border-2 bg-bg-2 p-3 shadow-dropdown">
        <div
          className="mb-2 block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium text-text-1"
          title={title}
        >
          {title}
        </div>
        <div className="space-y-2">
          <SessionHoverCardRow
            icon={agentSessionInfo.icon}
            iconClassName={agentSessionInfo.textClassName}
          >
            <div
              className={`truncate ${agentSessionInfo.textClassName ?? "text-text-2"}`}
            >
              {agentSessionInfo.label}
            </div>
          </SessionHoverCardRow>
          {repoName && (
            <SessionHoverCardRow icon={<Code2 size={13} strokeWidth={1.75} />}>
              <div className="truncate text-text-2">{repoName}</div>
            </SessionHoverCardRow>
          )}
          {branchLabel && (
            <SessionHoverCardRow
              icon={<GitBranch size={13} strokeWidth={1.75} />}
            >
              <div className="truncate text-text-2">{branchLabel}</div>
            </SessionHoverCardRow>
          )}
          {repoPath && (
            <SessionHoverCardRow icon={<Folder size={13} strokeWidth={1.75} />}>
              <div className="truncate text-text-2">
                {formatCompactPath(repoPath)}
              </div>
            </SessionHoverCardRow>
          )}
          {modelLabel && (
            <SessionHoverCardRow
              icon={
                modelIconName ? (
                  <ModelIcon
                    modelName={modelIconName}
                    agentType={modelIconAgent}
                    size={13}
                  />
                ) : (
                  <Grip size={13} strokeWidth={1.75} />
                )
              }
            >
              <div className="truncate text-text-2" title={modelTitle}>
                {modelLabel}
              </div>
            </SessionHoverCardRow>
          )}
          {turnOverview && turnOverview.turnCount > 0 && (
            <SessionHoverCardRow
              icon={<MessagesSquare size={13} strokeWidth={1.75} />}
            >
              <div className="truncate text-text-2">
                <span className="text-text-3">
                  {t("history.detail.rounds")}
                </span>
                <span className="mx-1 text-text-4">·</span>
                <span>
                  {t("history.detail.roundCount", {
                    count: turnOverview.turnCount,
                  })}
                </span>
              </div>
            </SessionHoverCardRow>
          )}
          {workedDurationLabel && (
            <SessionHoverCardRow icon={<Timer size={13} strokeWidth={1.75} />}>
              <div className="truncate text-text-2" title={workedDurationLabel}>
                <span className="text-text-3">
                  {t("history.detail.agentWorked")}
                </span>
                <span className="mx-1 text-text-4">·</span>
                <span>{workedDurationLabel}</span>
              </div>
            </SessionHoverCardRow>
          )}
          <SessionHoverCardRow icon={<Clock size={13} strokeWidth={1.75} />}>
            <div className="truncate text-text-2" title={createdLabel}>
              <span className="text-text-3">{t("history.detail.created")}</span>
              <span className="mx-1 text-text-4">·</span>
              <span>{createdLabel}</span>
            </div>
          </SessionHoverCardRow>
          <SessionHoverCardRow
            icon={<GitCommitVertical size={13} strokeWidth={1.75} />}
          >
            <div className="truncate text-text-2" title={updatedLabel}>
              <span className="text-text-3">
                {t("history.detail.lastUpdated")}
              </span>
              <span className="mx-1 text-text-4">·</span>
              <span>{updatedLabel}</span>
            </div>
          </SessionHoverCardRow>
        </div>
      </div>
    );
  });

SessionHoverCardContent.displayName = "SessionHoverCardContent";
