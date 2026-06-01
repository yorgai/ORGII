/**
 * FileHotspots — Top most-edited files for a given date range.
 *
 * Fetches from dev_record_get_file_hotspots and renders a SettingsTable
 * sorted by edit count. Long paths are truncated to show .../{parent}/{filename}.
 */
import React, { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordFileHotspots } from "@src/api/tauri/devRecord";
import type { FileHotspot } from "@src/api/tauri/devRecord/types";
import FileTypeIcon from "@src/components/FileTypeIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import type { FetchResult } from "./config";

const MAX_FILE_HOTSPOTS = 30;

function truncateFilePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return parts.join("/");
  return `.../${parts.slice(-2).join("/")}`;
}

interface FileHotspotsProps {
  startDate: string;
  endDate: string;
  refreshKey: number;
}

const FileHotspots: React.FC<FileHotspotsProps> = ({
  startDate,
  endDate,
  refreshKey,
}) => {
  const { t } = useTranslation();
  const fetchKey = `hotspots:${startDate}:${endDate}:${refreshKey}`;

  const [result, setResult] = useState<FetchResult<FileHotspot[]> | null>(null);
  const validResult = result?.key === fetchKey ? result : null;

  useEffect(() => {
    const effectKey = `hotspots:${startDate}:${endDate}:${refreshKey}`;
    let cancelled = false;

    getDevRecordFileHotspots(startDate, endDate, MAX_FILE_HOTSPOTS)
      .then((data) => {
        if (!cancelled) setResult({ key: effectKey, data, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setResult({
            key: effectKey,
            data: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, refreshKey]);

  const hotspots = (validResult ?? result)?.data ?? [];

  const columns = useMemo<SettingsTableColumn<FileHotspot>[]>(
    () => [
      {
        key: "file",
        label: t("devActivity.fileHotspots"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={row.filePath}
          >
            <FileTypeIcon
              fileName={row.filePath}
              size="small"
              className="shrink-0"
            />
            <span className={`${SETTINGS_TABLE_CELL.primary} truncate`}>
              {truncateFilePath(row.filePath)}
            </span>
          </span>
        ),
      },
      {
        key: "edits",
        label: t("projects.editCount"),
        width: "80px",
        align: "right",
        sorter: (rowA, rowB) => rowA.editCount - rowB.editCount,
        renderCell: (row) => (
          <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
            {row.editCount.toLocaleString()}
          </span>
        ),
      },
      {
        key: "commits",
        label: t("devActivity.commits"),
        width: "80px",
        align: "right",
        sorter: (rowA, rowB) => rowA.commitCount - rowB.commitCount,
        renderCell: (row) =>
          row.commitCount > 0 ? (
            <span className={`${SETTINGS_TABLE_CELL.value} tabular-nums`}>
              {row.commitCount.toLocaleString()}
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

  if (validResult?.error) {
    return <Placeholder variant="error" title={validResult.error} />;
  }

  if (!validResult && !result) {
    return <Placeholder variant="loading" />;
  }

  if (hotspots.length === 0) return null;

  return (
    <CollapsibleSection title={t("devActivity.fileHotspots")}>
      <SettingsTable<FileHotspot>
        columns={columns}
        rows={hotspots}
        getRowKey={(row) => row.filePath}
        headerHeight="tall"
        pageSize={50}
        className=""
      />
    </CollapsibleSection>
  );
};

export default memo(FileHotspots);
