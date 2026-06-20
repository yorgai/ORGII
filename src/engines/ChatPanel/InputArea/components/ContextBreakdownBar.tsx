/**
 * ContextBreakdownBar
 *
 * Segmented horizontal bar in the context-info panel showing token
 * distribution across categories. Dims non-hovered segments when a
 * category row is hovered.
 */
import { memo } from "react";

import type { PanelCategory } from "./contextInfoTypes";
import { formatTokenCount } from "./useContextUsageInfo";

export interface ContextBreakdownBarProps {
  categories: PanelCategory[];
  maxTokens: number;
  hoveredKey: string | null;
  fallbackPercentage?: number;
}

const ContextBreakdownBar = memo(
  ({
    categories,
    maxTokens,
    hoveredKey,
    fallbackPercentage = 0,
  }: ContextBreakdownBarProps) => {
    const total = categories.reduce((acc, cat) => acc + cat.tokens, 0);
    if (total === 0 || maxTokens === 0) {
      const fallbackWidth = Math.min(Math.max(fallbackPercentage, 0), 100);
      return (
        <div className="h-[5px] w-full overflow-hidden rounded-full bg-fill-3">
          {fallbackWidth > 0 && (
            <div
              className="h-full bg-primary-6"
              style={{ width: `${fallbackWidth}%` }}
            />
          )}
        </div>
      );
    }

    const hasHover = hoveredKey !== null;

    return (
      <div className="flex h-[5px] w-full gap-px overflow-hidden rounded-full bg-fill-3">
        {categories.map((cat) => {
          if (cat.tokens <= 0) return null;
          const widthPct = Math.min((cat.tokens / maxTokens) * 100, 100);
          const isActive = cat.key === hoveredKey;
          const opacity = hasHover && !isActive ? 0.25 : 1;
          return (
            <div
              key={cat.key}
              className="h-full shrink-0"
              style={{
                width: `${widthPct}%`,
                backgroundColor: cat.hex,
                opacity,
                transition: "opacity 0.15s ease",
              }}
              title={`${cat.label}: ${formatTokenCount(cat.tokens)}`}
            />
          );
        })}
      </div>
    );
  }
);

ContextBreakdownBar.displayName = "ContextBreakdownBar";

export default ContextBreakdownBar;
