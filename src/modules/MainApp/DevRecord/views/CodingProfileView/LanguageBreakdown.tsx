import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordLanguageStats } from "@src/api/tauri/devRecord";
import type { LanguageStat } from "@src/api/tauri/devRecord/types";
import FileTypeIcon from "@src/components/FileTypeIcon";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import {
  CollapsibleTableSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";
import { getLanguageIconFile } from "@src/util/language/languageMap";

import type { FetchResult } from "./config";

interface LanguageBreakdownProps {
  startDate: string;
  endDate: string;
  refreshKey?: number;
}

const LanguageBreakdown: React.FC<LanguageBreakdownProps> = memo(
  ({ startDate, endDate, refreshKey }) => {
    const { t } = useTranslation();

    const [retryCount, setRetryCount] = useState(0);
    const fetchKey = `lang:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
    const [result, setResult] = useState<FetchResult<LanguageStat[]> | null>(
      null
    );
    const validResult = result?.key === fetchKey ? result : null;

    const handleRetry = useCallback(() => {
      setRetryCount((prev) => prev + 1);
    }, []);

    useEffect(() => {
      const effectKey = `lang:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
      let cancelled = false;

      getDevRecordLanguageStats(startDate, endDate)
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
    }, [startDate, endDate, refreshKey, retryCount]);

    const stats = (validResult ?? result)?.data ?? [];

    const columns = useMemo<SettingsTableColumn<LanguageStat>[]>(
      () => [
        {
          key: "language",
          label: t("devActivity.languageEvolution"),
          width: SETTINGS_TABLE_COL.fill,
          sorter: (rowA, rowB) => rowA.language.localeCompare(rowB.language),
          renderCell: (stat) => (
            <span
              className={`${SETTINGS_TABLE_CELL.primary} flex items-center gap-2 truncate`}
            >
              <FileTypeIcon
                fileName={getLanguageIconFile(stat.language)}
                size="small"
                className="shrink-0"
              />
              {stat.language}
            </span>
          ),
        },
        {
          key: "edits",
          label: t("devActivity.fileEdits"),
          width: SETTINGS_TABLE_COL.valueMd,
          align: "right",
          sorter: (rowA, rowB) => rowA.fileEdits - rowB.fileEdits,
          renderCell: (stat) => (
            <span
              className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap tabular-nums`}
            >
              {stat.fileEdits.toLocaleString()}
            </span>
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
          renderCell: (stat) =>
            stat.linesAdded > 0 || stat.linesRemoved > 0 ? (
              <span className="whitespace-nowrap tabular-nums">
                <span className="text-green-500">
                  +{stat.linesAdded.toLocaleString()}
                </span>{" "}
                <span className="text-red-400">
                  -{stat.linesRemoved.toLocaleString()}
                </span>
              </span>
            ) : (
              <span className={SETTINGS_TABLE_CELL.muted}>—</span>
            ),
        },
      ],
      [t]
    );

    if (!result) return <Placeholder variant="loading" />;
    if (validResult?.error)
      return (
        <Placeholder
          variant="error"
          title={validResult.error}
          onRetry={handleRetry}
        />
      );
    if (stats.length === 0) return null;

    return (
      <CollapsibleTableSection
        noWrapper
        title={t("devActivity.languageEvolution")}
      >
        <SettingsTable<LanguageStat>
          columns={columns}
          rows={stats.slice(0, 10)}
          getRowKey={(stat) => stat.language}
          headerHeight="tall"
          pageSize={50}
          className="[&_.table]:table-fixed"
        />
      </CollapsibleTableSection>
    );
  }
);

LanguageBreakdown.displayName = "LanguageBreakdown";

export default LanguageBreakdown;
