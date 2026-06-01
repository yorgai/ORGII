/**
 * MultiLineChart
 *
 * A reusable line chart component that displays multiple series with colored lines.
 * Commonly used for time-series data grouped by contributor, category, or any dimension.
 *
 * Usage:
 *   <MultiLineChart
 *     data={[{ date: "Mar 24", "Alice": 50, "Bob": 30 }, ...]}
 *     series={["Alice", "Bob"]}
 *   />
 */
import { memo, useCallback } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CurveType } from "recharts/types/shape/Curve";

import ChartTooltip from "./ChartTooltip";
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_MARGIN } from "./tokens";

export interface MultiLineDataPoint {
  /** X-axis key value (usually date string like "Mar 24") */
  date: string;
  /** Dynamic series keys with numeric values */
  [seriesKey: string]: number | string | undefined;
}

export interface MultiLineChartProps {
  /** Chart data points - each point has date and series values */
  data: MultiLineDataPoint[];
  /** List of series keys to render as lines */
  series: string[];
  /** Map of series key to color string (optional - uses default palette if not provided) */
  colorMap?: Map<string, string>;
  /** Chart height in pixels (default: 260) */
  height?: number;
  /** Key for X-axis data (default: "date") */
  xAxisKey?: string;
  /** Y-axis label text */
  yAxisLabel?: string;
  /** Y-axis tick formatter (e.g., (v) => `$${v}`) */
  yAxisFormatter?: (value: number) => string;
  /** Tooltip value formatter (e.g., (v) => `$${v.toFixed(2)}`) */
  tooltipFormatter?: (value: number) => string;
  /** Whether to show legend (default: true) */
  showLegend?: boolean;
  /** Line curve type (default: "monotone") */
  curveType?: CurveType;
  /** Line stroke width (default: 2) */
  strokeWidth?: number;
  /** Whether to show dots on data points (default: false) */
  dot?: boolean;
  /** Additional CSS class for the container */
  className?: string;
}

const DEFAULT_COLORS = [
  "var(--color-primary-6)",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#38bdf8",
  "#fb923c",
  "#4ade80",
  "#e879f9",
  "#22d3ee",
] as const;

const LEGEND_STYLE = {
  iconType: "circle" as const,
  iconSize: 8,
  wrapperStyle: {
    paddingTop: 16,
    fontSize: 11,
  },
};

function MultiLineChart({
  data,
  series,
  colorMap,
  height = 260,
  xAxisKey = "date",
  yAxisLabel,
  yAxisFormatter,
  tooltipFormatter,
  showLegend = true,
  curveType = "monotone",
  strokeWidth = 2,
  dot = false,
  className,
}: MultiLineChartProps) {
  const getColor = useCallback(
    (seriesKey: string, index: number): string => {
      if (colorMap?.has(seriesKey)) {
        return colorMap.get(seriesKey)!;
      }
      return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
    },
    [colorMap]
  );

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={CHART_GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey={xAxisKey}
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={CHART_AXIS_TICK}
            allowDecimals={false}
            width={50}
            label={
              yAxisLabel
                ? {
                    value: yAxisLabel,
                    angle: -90,
                    position: "insideLeft",
                    style: {
                      textAnchor: "middle",
                      fill: "var(--color-text-3)",
                    },
                  }
                : undefined
            }
            tickFormatter={yAxisFormatter}
          />
          <Tooltip
            content={<ChartTooltip formatValue={tooltipFormatter} />}
            cursor={{ stroke: "var(--color-border-2)", strokeDasharray: "3 3" }}
          />
          {showLegend && (
            <Legend
              iconType={LEGEND_STYLE.iconType}
              iconSize={LEGEND_STYLE.iconSize}
              wrapperStyle={LEGEND_STYLE.wrapperStyle}
            />
          )}
          {series.map((seriesKey, index) => (
            <Line
              key={seriesKey}
              type={curveType}
              dataKey={seriesKey}
              name={seriesKey}
              stroke={getColor(seriesKey, index)}
              strokeWidth={strokeWidth}
              dot={dot}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default memo(MultiLineChart);
