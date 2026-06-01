/**
 * HourlyAxisTick — X-axis tick for multi-day hourly bar charts.
 *
 * Renders time (12am, 4am, etc.) on the main line, and date (3/5) in bold
 * below only at midnight, avoiding repeated date labels.
 */
import React from "react";

import { CHART_AXIS_TICK, CHART_AXIS_TICK_BOLD } from "@src/components/Chart";

import type { DailyCommitData } from "./types";

interface HourlyAxisTickProps {
  data: DailyCommitData[];
  x?: number;
  y?: number;
  payload?: { value: string };
  textAnchor?: "start" | "middle" | "end" | "inherit";
  index?: number;
}

const HourlyAxisTick: React.FC<HourlyAxisTickProps> = ({
  x = 0,
  y = 0,
  payload,
  textAnchor = "middle",
  index = 0,
  data,
}) => {
  const value = payload?.value;
  if (value === undefined || value === null) return null;

  const row = data[index];
  const dayLabel = row?.dayLabel;

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        textAnchor={textAnchor}
        dy="0.71em"
        fill={CHART_AXIS_TICK.fill}
        fontSize={CHART_AXIS_TICK.fontSize}
        fontWeight={400}
      >
        {value}
      </text>
      {dayLabel && (
        <text
          textAnchor={textAnchor}
          dy="1.6em"
          fill={CHART_AXIS_TICK_BOLD.fill}
          fontSize={CHART_AXIS_TICK_BOLD.fontSize}
          fontWeight={CHART_AXIS_TICK_BOLD.fontWeight}
        >
          {dayLabel}
        </text>
      )}
    </g>
  );
};

export default HourlyAxisTick;
