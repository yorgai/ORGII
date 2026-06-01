/**
 * FocusHeatmap — Hour-of-day × Day-of-week coding activity heatmap.
 *
 * Fetches heatmap data from the coding tracker and delegates
 * rendering to the shared HeatmapGrid component.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDevRecordHeatmap } from "@src/api/tauri/devRecord";
import type { HeatmapCell } from "@src/api/tauri/devRecord/types";
import {
  CollapsibleSection,
  Placeholder,
} from "@src/modules/shared/layouts/blocks";

import HeatmapGrid from "../../components/HeatmapGrid";
import type {
  HeatmapGridCell,
  HeatmapGridLabel,
} from "../../components/HeatmapGrid";
import { DAY_LABELS, type FetchResult, HOUR_LABELS } from "./config";

interface FocusHeatmapProps {
  startDate: string;
  endDate: string;
  refreshKey?: number;
}

const X_LABELS: HeatmapGridLabel[] = HOUR_LABELS.map((label, idx) => ({
  label,
  index: idx * 4,
}));

const Y_LABELS: HeatmapGridLabel[] = [
  { label: DAY_LABELS[1], index: 1 },
  { label: DAY_LABELS[3], index: 3 },
  { label: DAY_LABELS[5], index: 5 },
];

function buildGridCells(heatmap: HeatmapCell[]): {
  cells: HeatmapGridCell[];
  maxCount: number;
} {
  const counts: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  for (const cell of heatmap) {
    if (cell.dayOfWeek < 7 && cell.hour < 24) {
      counts[cell.dayOfWeek][cell.hour] = cell.count;
    }
  }

  let maxCount = 0;
  const cells: HeatmapGridCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = counts[day][hour];
      if (count > maxCount) maxCount = count;
      cells.push({
        xIndex: hour,
        yIndex: day,
        count,
        label: `${DAY_LABELS[day]} ${hour}:00`,
      });
    }
  }
  return { cells, maxCount: Math.max(maxCount, 1) };
}

const FocusHeatmap: React.FC<FocusHeatmapProps> = memo(
  ({ startDate, endDate, refreshKey }) => {
    const { t } = useTranslation();

    const [retryCount, setRetryCount] = useState(0);
    const fetchKey = `heatmap:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
    const [result, setResult] = useState<FetchResult<HeatmapCell[]> | null>(
      null
    );
    const validResult = result?.key === fetchKey ? result : null;

    const handleRetry = useCallback(() => {
      setRetryCount((prev) => prev + 1);
    }, []);

    useEffect(() => {
      const effectKey = `heatmap:${startDate}:${endDate}:${refreshKey ?? 0}:${retryCount}`;
      let cancelled = false;

      getDevRecordHeatmap(startDate, endDate)
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

    const heatmap = useMemo(
      () => (validResult ?? result)?.data ?? [],
      [validResult, result]
    );

    const { cells: gridCells, maxCount } = useMemo(
      () => buildGridCells(heatmap),
      [heatmap]
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
    if (heatmap.length === 0) return null;

    return (
      <CollapsibleSection title={t("devActivity.focusPatterns")}>
        <div className="rounded-lg bg-fill-2 p-4">
          <HeatmapGrid
            cells={gridCells}
            xCount={24}
            yCount={7}
            xLabels={X_LABELS}
            yLabels={Y_LABELS}
            maxCount={maxCount}
            unit="heartbeat"
          />
        </div>
      </CollapsibleSection>
    );
  }
);

FocusHeatmap.displayName = "FocusHeatmap";

export default FocusHeatmap;
