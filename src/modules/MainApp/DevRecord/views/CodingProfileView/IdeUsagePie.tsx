import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { getDevRecordIdeUsage } from "@src/api/tauri/devRecord";
import type { IdeUsageStat } from "@src/api/tauri/devRecord/types";
import { ChartTooltip } from "@src/components/Chart";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import {
  type FetchResult,
  IDE_COLORS,
  formatDuration,
  formatSourceLabel,
} from "./config";

interface IdeUsagePieProps {
  startDate: string;
  endDate: string;
  refreshKey?: number;
}

const IdeUsagePie: React.FC<IdeUsagePieProps> = memo(
  ({ startDate, endDate, refreshKey }) => {
    const { t } = useTranslation();

    const [retryCount, setRetryCount] = useState(0);
    const fetchKey = `ide:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
    const [result, setResult] = useState<FetchResult<IdeUsageStat[]> | null>(
      null
    );
    const validResult = result?.key === fetchKey ? result : null;

    const handleRetry = useCallback(() => {
      setRetryCount((prev) => prev + 1);
    }, []);

    useEffect(() => {
      const effectKey = `ide:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
      let cancelled = false;

      getDevRecordIdeUsage(startDate, endDate)
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

    const ideUsage = useMemo(
      () => (validResult ?? result)?.data ?? [],
      [validResult, result]
    );

    const pieData = useMemo(
      () =>
        ideUsage.map((stat) => ({
          name: formatSourceLabel(stat.source),
          value: stat.totalSeconds,
        })),
      [ideUsage]
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
    if (pieData.length === 0) return null;

    return (
      <CollapsibleSection title={t("devActivity.ideUsage")}>
        <div className="flex items-center gap-6 rounded-lg bg-fill-2 p-4">
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={40}
                isAnimationActive={false}
              >
                {pieData.map((_entry, index) => (
                  <Cell
                    key={index}
                    fill={IDE_COLORS[index % IDE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                content={
                  <ChartTooltip
                    formatValue={(value) => formatDuration(value)}
                  />
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-col gap-2">
            {ideUsage.map((stat, index) => (
              <div key={stat.source} className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded"
                  style={{
                    background: IDE_COLORS[index % IDE_COLORS.length],
                  }}
                />
                <span className="text-[12px] text-text-2">
                  {formatSourceLabel(stat.source)}
                </span>
                <span className="text-[11px] text-text-2">
                  {formatDuration(stat.totalSeconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    );
  }
);

IdeUsagePie.displayName = "IdeUsagePie";

export default IdeUsagePie;
