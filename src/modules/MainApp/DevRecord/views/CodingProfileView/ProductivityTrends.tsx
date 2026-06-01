import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { DailySummary } from "@src/api/tauri/devRecord/types";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import { CollapsibleSection } from "@src/modules/shared/layouts/blocks";

import { formatSourceLabel } from "./config";

interface DailyRow {
  date: string;
  source: string;
  linesAdded: number;
  linesRemoved: number;
  fileEdits: number;
  filesTouched: number;
  terminalCmds: number;
  agentActions: number;
}

interface ProductivityTrendsProps {
  summary: DailySummary[];
}

const ProductivityTrends: React.FC<ProductivityTrendsProps> = memo(
  ({ summary }) => {
    const { t } = useTranslation();

    const rows = useMemo<DailyRow[]>(() => {
      const byDate = new Map<
        string,
        {
          source: string;
          linesAdded: number;
          linesRemoved: number;
          fileEdits: number;
          filesTouched: number;
          terminalCmds: number;
          agentActions: number;
        }
      >();

      for (const row of summary) {
        const existing = byDate.get(row.date);
        if (existing) {
          existing.linesAdded += row.linesAdded;
          existing.linesRemoved += row.linesRemoved;
          existing.fileEdits += row.fileEdits;
          existing.filesTouched += row.filesTouched;
          existing.terminalCmds += row.terminalCmds;
          existing.agentActions += row.agentActions;
        } else {
          byDate.set(row.date, {
            source: row.primarySource,
            linesAdded: row.linesAdded,
            linesRemoved: row.linesRemoved,
            fileEdits: row.fileEdits,
            filesTouched: row.filesTouched,
            terminalCmds: row.terminalCmds,
            agentActions: row.agentActions,
          });
        }
      }

      return Array.from(byDate.entries())
        .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
        .map(([date, values]) => ({ date, ...values }));
    }, [summary]);

    const columns = useMemo<SettingsTableColumn<DailyRow>[]>(
      () => [
        {
          key: "date",
          label: t("devActivity.cursorTime"),
          width: SETTINGS_TABLE_COL.valueMd,
          sorter: (rowA, rowB) => rowB.date.localeCompare(rowA.date),
          renderCell: (row) => (
            <span
              className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap tabular-nums`}
            >
              {new Date(row.date + "T00:00").toLocaleDateString([], {
                month: "short",
                day: "numeric",
                weekday: "short",
              })}
            </span>
          ),
        },
        {
          key: "source",
          label: t("devActivity.source"),
          width: "100px",
          renderCell: (row) => (
            <span className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap`}>
              {formatSourceLabel(row.source)}
            </span>
          ),
        },
        {
          key: "fileEdits",
          label: t("devActivity.fileEdits"),
          width: "80px",
          align: "right",
          sorter: (rowA, rowB) => rowA.fileEdits - rowB.fileEdits,
          renderCell: (row) => (
            <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
              {row.fileEdits.toLocaleString()}
            </span>
          ),
        },
        {
          key: "files",
          label: t("devActivity.filesTouched"),
          width: "80px",
          align: "right",
          sorter: (rowA, rowB) => rowA.filesTouched - rowB.filesTouched,
          renderCell: (row) => (
            <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
              {row.filesTouched.toLocaleString()}
            </span>
          ),
        },
        {
          key: "terminal",
          label: t("devActivity.terminalCmds"),
          width: "70px",
          align: "right",
          sorter: (rowA, rowB) => rowA.terminalCmds - rowB.terminalCmds,
          renderCell: (row) =>
            row.terminalCmds > 0 ? (
              <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
                {row.terminalCmds.toLocaleString()}
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
        {
          key: "agent",
          label: t("devActivity.agentActions"),
          width: "70px",
          align: "right",
          sorter: (rowA, rowB) => rowA.agentActions - rowB.agentActions,
          renderCell: (row) =>
            row.agentActions > 0 ? (
              <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
                {row.agentActions.toLocaleString()}
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
        {
          key: "lines",
          label: t("devActivity.linesChanged"),
          width: SETTINGS_TABLE_COL.valueMd,
          align: "right",
          sorter: (rowA, rowB) =>
            rowA.linesAdded +
            rowA.linesRemoved -
            (rowB.linesAdded + rowB.linesRemoved),
          renderCell: (row) =>
            row.linesAdded > 0 || row.linesRemoved > 0 ? (
              <span className="whitespace-nowrap tabular-nums">
                <span className="text-green-500">
                  +{row.linesAdded.toLocaleString()}
                </span>{" "}
                <span className="text-red-400">
                  -{row.linesRemoved.toLocaleString()}
                </span>
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
      ],
      [t]
    );

    if (rows.length === 0) return null;

    return (
      <CollapsibleSection title={t("devActivity.productivityTrends")}>
        <SettingsTable<DailyRow>
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.date}
          headerHeight="tall"
          pageSize={50}
          className="[&_.table]:table-fixed"
        />
      </CollapsibleSection>
    );
  }
);

ProductivityTrends.displayName = "ProductivityTrends";

export default ProductivityTrends;
