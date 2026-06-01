/**
 * ChartTooltip — compact, multi-column Recharts custom tooltip.
 *
 * Drop-in replacement for the default Recharts tooltip. Filters zero-value
 * entries, sorts by value descending, and switches to a 2-column grid
 * when entries exceed MULTI_COL_THRESHOLD.
 *
 * Usage:
 *   <Tooltip content={<ChartTooltip />} cursor={false} />
 */
import React from "react";

import { CHART_TOOLTIP } from "./tokens";

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color?: string;
  fill?: string;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  /** Hide the label/header row (e.g. for pie chart tooltip in center) */
  hideLabel?: boolean;
  /** Optional value formatter (e.g. (v) => `$${v.toFixed(2)}`, (v) => `${v}m`) */
  formatValue?: (value: number) => string;
  /** Optional name formatter (e.g. for translating series labels) */
  formatName?: (name: string) => string;
}

const MULTI_COL_THRESHOLD = 6;

const labelStyle: React.CSSProperties = {
  ...CHART_TOOLTIP.label,
  fontSize: 11,
  fontWeight: 500,
};

const itemStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: "20px",
};

const ChartTooltip: React.FC<ChartTooltipProps> = ({
  active,
  payload,
  label,
  hideLabel = false,
  formatValue,
  formatName,
}) => {
  if (!active || !payload?.length) return null;

  const entries = payload
    .filter((entry) => entry.value > 0)
    .sort((entryA, entryB) => entryB.value - entryA.value);

  if (entries.length === 0) return null;

  const colCount = entries.length > MULTI_COL_THRESHOLD ? 2 : 1;
  const rowCount = Math.ceil(entries.length / colCount);

  return (
    <div
      style={{
        ...CHART_TOOLTIP.content,
        ...(hideLabel ? { display: "flex", alignItems: "center" } : {}),
      }}
    >
      {!hideLabel && <p style={labelStyle}>{label}</p>}
      <div
        style={
          colCount > 1
            ? {
                display: "grid",
                gridTemplateRows: `repeat(${rowCount}, auto)`,
                gridAutoFlow: "column",
                columnGap: 16,
              }
            : undefined
        }
      >
        {entries.map((entry) => {
          const color = entry.color ?? entry.fill ?? "var(--color-text-2)";
          const displayName = formatName ? formatName(entry.name) : entry.name;
          const displayValue = formatValue
            ? formatValue(entry.value)
            : String(entry.value);
          return (
            <div
              key={entry.name}
              className="flex items-center gap-1.5"
              style={itemStyle}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: color }}
              />
              <span
                className="truncate"
                style={{ color: "var(--color-text-2)" }}
              >
                {displayName}
              </span>
              <span
                className="ml-auto shrink-0 tabular-nums"
                style={{ color: "var(--color-text-1)" }}
              >
                {displayValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

ChartTooltip.displayName = "ChartTooltip";

export default ChartTooltip;
