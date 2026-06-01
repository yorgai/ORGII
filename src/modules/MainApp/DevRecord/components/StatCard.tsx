/**
 * StatCard — Unified stat card for DevRecord dashboards.
 *
 * Renders an icon, label, and value with dynamic text sizing
 * that shrinks to prevent wrapping to a second line.
 * Optional `delta` shows a period-over-period percentage change.
 */
import {
  Loader2,
  type LucideIcon,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import React, { type ReactNode, memo } from "react";

import { SPINNER_TOKENS } from "@src/config/spinnerTokens";

export interface StatCardDelta {
  percent: number;
  label?: string;
}

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
  delta?: StatCardDelta;
}

function DeltaBadge({ percent, label }: StatCardDelta) {
  if (!Number.isFinite(percent)) return null;
  const isPositive = percent > 0;
  const isZero = percent === 0;
  const sign = isPositive ? "+" : "";
  const colorClass = isZero
    ? "text-text-2"
    : isPositive
      ? "text-green-500"
      : "text-red-400";
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colorClass}`}
      title={label}
    >
      {!isZero && <TrendIcon size={10} />}
      {sign}
      {Math.round(percent)}%
    </span>
  );
}

const StatCard: React.FC<StatCardProps> = memo(
  ({ icon: Icon, label, children, delta }) => (
    <div className="flex items-center gap-3 rounded-lg bg-fill-2 px-3 py-2.5">
      <Icon size={16} className="shrink-0 text-text-2" />
      <div className="min-w-0">
        <span className="block truncate text-[11px] font-medium text-text-2">
          {label}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-base font-semibold leading-tight text-text-1">
          {children}
          {delta != null && <DeltaBadge {...delta} />}
        </span>
      </div>
    </div>
  )
);

StatCard.displayName = "StatCard";

export default StatCard;

export function DiffValue({
  added,
  removed,
  loading,
}: {
  added: number;
  removed: number;
  loading?: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0 tabular-nums">
      <span className="text-green-500">+{added.toLocaleString()}</span>
      <span className="text-red-400">-{removed.toLocaleString()}</span>
      {loading && (
        <Loader2
          size={SPINNER_TOKENS.small}
          className="shrink-0 animate-spin text-text-2"
        />
      )}
    </span>
  );
}
