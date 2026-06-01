/**
 * CommitDotGraph — GitHub-style contribution heatmap grid.
 *
 * Delegates rendering to the shared HeatmapGrid component.
 */
import React, { memo, useMemo } from "react";

import HeatmapGrid from "../../components/HeatmapGrid";
import type { HeatmapGridCell } from "../../components/HeatmapGrid";
import type { DotGraphDataResult } from "./dataBuilders";

interface CommitDotGraphProps {
  data: DotGraphDataResult;
}

const Y_LABEL_WIDTH_DAILY = 28;
const Y_LABEL_WIDTH_HOURLY = 40;

const CommitDotGraph: React.FC<CommitDotGraphProps> = memo(({ data }) => {
  const { cells, maxCount, xCount, yCount, xLabels, yLabels, isHourly } = data;

  const gridCells = useMemo<HeatmapGridCell[]>(
    () => cells.map((cell) => ({ ...cell, label: cell.dateKey })),
    [cells]
  );

  return (
    <HeatmapGrid
      cells={gridCells}
      xCount={xCount}
      yCount={yCount}
      xLabels={xLabels}
      yLabels={yLabels}
      maxCount={maxCount}
      unit="commit"
      yLabelWidth={isHourly ? Y_LABEL_WIDTH_HOURLY : Y_LABEL_WIDTH_DAILY}
    />
  );
});

CommitDotGraph.displayName = "CommitDotGraph";

export default CommitDotGraph;
