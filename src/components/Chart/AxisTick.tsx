/**
 * ChartAxisTick — Reusable custom tick renderer for Recharts XAxis / YAxis.
 *
 * Default labels use text-2. Pass `boldValues` (a Set of tick values) or
 * `isBold` (predicate) to render specific ticks as text-1 + semibold.
 * Pass `allBold` to render every tick as text-1 + semibold.
 *
 * For Y-axis ticks with icons, pass `iconRenderer` — returns a React node
 * for the given tick value. Uses foreignObject so any React component works.
 *
 * Usage:
 *   <XAxis tick={<ChartAxisTick boldValues={new Set([0, 50])} />} />
 *   <YAxis tick={<ChartAxisTick isBold={(v) => v % 50 === 0} axis="y" />} />
 *   <YAxis tick={<ChartAxisTick axis="y" allBold iconRenderer={(v) => <MyIcon name={v} />} />} />
 */
import React from "react";

import { CHART_AXIS_TICK, CHART_AXIS_TICK_BOLD } from "./tokens";

// ============================================
// Types
// ============================================

interface ChartAxisTickProps {
  /** Specific values that should render bold + text-1. */
  boldValues?: Set<number | string>;

  /**
   * Predicate to determine if a tick value should be bold.
   * Receives the tick value, its index, and total visible tick count.
   */
  isBold?: (value: number | string, index: number, total: number) => boolean;

  /** When true, all ticks render as text-1 + semibold. */
  allBold?: boolean;

  /** Format the displayed tick value. */
  formatter?: (value: number | string) => string;

  /**
   * Render a React node (e.g. icon) to the left of the tick label.
   * Only supported for axis="y". Uses foreignObject for HTML embedding.
   */
  iconRenderer?: (value: string | number) => React.ReactNode;

  /**
   * Axis direction — controls the dy offset for proper alignment.
   * "x" (default) for XAxis, "y" for YAxis.
   */
  axis?: "x" | "y";

  // --- Props injected by Recharts (do not pass manually) ---
  x?: number;
  y?: number;
  payload?: { value: string | number };
  textAnchor?: string;
  index?: number;
  visibleTicksCount?: number;
}

// ============================================
// Component
// ============================================

const ICON_TICK_HEIGHT = 24;

const ChartAxisTick: React.FC<ChartAxisTickProps> = ({
  x,
  y,
  payload,
  textAnchor,
  index,
  visibleTicksCount,
  boldValues,
  isBold: isBoldFn,
  allBold = false,
  formatter,
  iconRenderer,
  axis = "x",
}) => {
  const value = payload?.value;
  if (value === undefined || value === null) return null;

  const emphasized =
    allBold ||
    (boldValues
      ? boldValues.has(value)
      : isBoldFn
        ? isBoldFn(value, index ?? 0, visibleTicksCount ?? 0)
        : false);

  const style = emphasized ? CHART_AXIS_TICK_BOLD : CHART_AXIS_TICK;
  const displayValue = formatter ? formatter(value) : String(value);

  if (iconRenderer && axis === "y") {
    const iconNode = iconRenderer(value);
    return (
      <foreignObject
        x={0}
        y={(y ?? 0) - ICON_TICK_HEIGHT / 2}
        width={(x ?? 0) + 2}
        height={ICON_TICK_HEIGHT}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            height: "100%",
            width: "100%",
          }}
        >
          <span
            style={{ flexShrink: 0, display: "flex", alignItems: "center" }}
          >
            {iconNode}
          </span>
          <span
            style={{
              fontSize: style.fontSize,
              color: style.fill,
              fontWeight: emphasized ? CHART_AXIS_TICK_BOLD.fontWeight : 400,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayValue}
          </span>
        </div>
      </foreignObject>
    );
  }

  const anchor: "end" | "inherit" | "start" | "middle" =
    (textAnchor as "end" | "inherit" | "start" | "middle") ??
    (axis === "y" ? "end" : "middle");

  return (
    <text
      x={x}
      y={y}
      dy={axis === "y" ? "0.35em" : "0.71em"}
      textAnchor={anchor}
      fill={style.fill}
      fontSize={style.fontSize}
      fontWeight={emphasized ? CHART_AXIS_TICK_BOLD.fontWeight : 400}
    >
      {displayValue}
    </text>
  );
};

export default ChartAxisTick;
