import { CheckCircle2, Clock, Code2, History, XCircle } from "lucide-react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getCursorSessions } from "@src/api/tauri/devRecord";
import type { CursorSession } from "@src/api/tauri/devRecord/types";
import ModelIcon from "@src/components/ModelIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import {
  CollapsibleSection,
  Placeholder,
  STAT_GRID_TOKENS,
} from "@src/modules/shared/layouts/blocks";

import StatCard, { DiffValue } from "../../components/StatCard";
import {
  formatDuration,
  formatModelNameFull,
} from "../CodingProfileView/config";
import { useSessionAutoRefresh } from "../CodingProfileView/useSessionAutoRefresh";

function sessionDurationSeconds(session: CursorSession): number {
  if (session.lastActiveAt <= session.createdAt) return 0;
  return Math.round((session.lastActiveAt - session.createdAt) / 1000);
}

interface CursorSessionsPanelProps {
  startDate: string;
  endDate: string;
  refreshKey?: number;
}

const CursorSessionsPanel: React.FC<CursorSessionsPanelProps> = memo(
  ({ startDate, endDate, refreshKey }) => {
    const { t } = useTranslation();

    const fetcher = useMemo(
      () => () => getCursorSessions(startDate, endDate),
      [startDate, endDate]
    );

    const { data, error, isInitialLoad } = useSessionAutoRefresh<
      CursorSession[]
    >({
      fetcher,
      countFromData: (sessions) => sessions.length,
      label: t("devActivity.cursorSessions"),
      formatSuccess: (label, count) => ({
        title: t("devActivity.refreshSuccess", { count, label }),
        description: t("devActivity.refreshSuccessDescription"),
      }),
      formatError: (label) => ({
        title: t("devActivity.refreshError", { label }),
        description: t("devActivity.refreshErrorDescription"),
      }),
      cacheKey: `cursor:${startDate}:${endDate}`,
      refreshKey,
    });

    const cursorSessions = useMemo(() => data ?? [], [data]);
    const loading = isInitialLoad;

    const cursorStats = useMemo(() => {
      const totalLinesAddedAI = cursorSessions.reduce(
        (acc, session) => acc + session.linesAdded,
        0
      );
      const totalLinesRemovedAI = cursorSessions.reduce(
        (acc, session) => acc + session.linesRemoved,
        0
      );

      const durations = cursorSessions.map(sessionDurationSeconds);
      const sessionsWithDuration = durations.filter((dur) => dur > 0);
      const avgDurationSeconds =
        sessionsWithDuration.length > 0
          ? Math.round(
              sessionsWithDuration.reduce((acc, dur) => acc + dur, 0) /
                sessionsWithDuration.length
            )
          : 0;

      return {
        totalLinesAddedAI,
        totalLinesRemovedAI,
        avgDurationSeconds,
      };
    }, [cursorSessions]);

    const columns = useMemo<SettingsTableColumn<CursorSession>[]>(
      () => [
        {
          key: "time",
          label: t("devActivity.cursorTime"),
          width: SETTINGS_TABLE_COL.valueMd,
          sorter: (rowA, rowB) => rowB.createdAt - rowA.createdAt,
          renderCell: (session) => (
            <span
              className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap tabular-nums`}
            >
              {new Date(session.createdAt).toLocaleDateString([], {
                month: "numeric",
                day: "numeric",
              })}{" "}
              {new Date(session.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}
            </span>
          ),
        },
        {
          key: "duration",
          label: t("devActivity.cursorDuration"),
          width: "80px",
          sorter: (rowA, rowB) =>
            sessionDurationSeconds(rowA) - sessionDurationSeconds(rowB),
          renderCell: (session) => {
            const dur = sessionDurationSeconds(session);
            return (
              <span
                className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap tabular-nums`}
              >
                {dur > 0 ? formatDuration(dur) : "—"}
              </span>
            );
          },
        },
        {
          key: "name",
          label: t("devActivity.cursorName"),
          width: SETTINGS_TABLE_COL.fill,
          renderCell: (session) => (
            <span
              className="flex min-w-0 items-center gap-1.5"
              title={session.name}
            >
              {session.status === "completed" ? (
                <CheckCircle2 size={12} className="shrink-0 text-green-500" />
              ) : (
                <XCircle size={12} className="shrink-0 text-red-400" />
              )}
              <span className={`${SETTINGS_TABLE_CELL.primary} truncate`}>
                {session.name || "—"}
              </span>
            </span>
          ),
        },
        {
          key: "model",
          label: t("devActivity.cursorTopModel"),
          width: SETTINGS_TABLE_COL.hug,
          renderCell: (session) => (
            <span
              className={`${SETTINGS_TABLE_CELL.statusRow} whitespace-nowrap`}
              title={session.model}
            >
              <ModelIcon modelName={session.model} size="small" />
              <span className="text-text-1">
                {formatModelNameFull(session.model) || "—"}
              </span>
            </span>
          ),
        },
        {
          key: "files",
          label: t("devActivity.filesTouched"),
          width: "70px",
          align: "right",
          sorter: (rowA, rowB) => rowA.filesChanged - rowB.filesChanged,
          renderCell: (session) =>
            session.filesChanged > 0 ? (
              <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
                {session.filesChanged}
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
        {
          key: "lines",
          label: t("devActivity.linesChanged"),
          width: "220px",
          align: "right",
          sorter: (rowA, rowB) =>
            rowA.linesAdded +
            rowA.linesRemoved -
            (rowB.linesAdded + rowB.linesRemoved),
          renderCell: (session) =>
            session.linesAdded > 0 || session.linesRemoved > 0 ? (
              <span className="inline-grid grid-cols-[1fr_1fr] gap-x-3 text-right tabular-nums">
                <span className="text-green-500">
                  +{session.linesAdded.toLocaleString()}
                </span>
                <span className="text-red-400">
                  -{session.linesRemoved.toLocaleString()}
                </span>
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
      ],
      [t]
    );

    if (loading)
      return (
        <div className="rounded-lg bg-fill-2 p-6">
          <Placeholder variant="loading" />
        </div>
      );
    if (error)
      return (
        <div className="rounded-lg bg-fill-2 p-6">
          <Placeholder variant="error" title={error} />
        </div>
      );

    const hasData = cursorSessions.length > 0;

    return (
      <CollapsibleSection title={t("devActivity.cursorSessions")}>
        <div className={`mb-4 ${STAT_GRID_TOKENS.cols3}`}>
          <StatCard icon={History} label={t("devActivity.sessions")}>
            {hasData
              ? cursorSessions.length.toLocaleString()
              : t("common:status.unknown")}
          </StatCard>
          <StatCard icon={Code2} label={t("devActivity.linesChanged")}>
            {hasData ? (
              <DiffValue
                added={cursorStats.totalLinesAddedAI}
                removed={cursorStats.totalLinesRemovedAI}
              />
            ) : (
              t("common:status.unknown")
            )}
          </StatCard>
          <StatCard icon={Clock} label={t("devActivity.cursorAvgDuration")}>
            {hasData && cursorStats.avgDurationSeconds > 0
              ? formatDuration(cursorStats.avgDurationSeconds)
              : t("common:status.unknown")}
          </StatCard>
        </div>
        <div className="rounded-lg bg-fill-2 px-4">
          {hasData ? (
            <SettingsTable<CursorSession>
              columns={columns}
              rows={cursorSessions}
              getRowKey={(session) => session.id}
              headerHeight="tall"
              pageSize={50}
            />
          ) : (
            <div className="py-6">
              <Placeholder
                variant="empty"
                title={t("devActivity.noCursorSessions")}
              />
            </div>
          )}
        </div>
      </CollapsibleSection>
    );
  }
);

CursorSessionsPanel.displayName = "CursorSessionsPanel";

export default CursorSessionsPanel;
