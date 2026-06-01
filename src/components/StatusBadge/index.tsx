/**
 * StatusBadge Component
 *
 * Unified status badge for displaying event/activity status.
 * Shows status with optional animated pulse indicator.
 */
import { memo, useMemo } from "react";

import { SIZE_CONFIG, getStatusStyle } from "./config";
import type { StatusBadgeProps } from "./types";

export const StatusBadge = memo<StatusBadgeProps>(
  ({
    status,
    size = "sm",
    showPulse = true,
    label: customLabel,
    className = "",
  }) => {
    const { bgColor, textColor, dotColor, label } = useMemo(
      () => getStatusStyle(status),
      [status]
    );

    const displayLabel = customLabel || label;
    const sizeConfig = SIZE_CONFIG[size];

    return (
      <div
        className={`flex items-center rounded-full font-bold tracking-wider ${bgColor} ${textColor} ${sizeConfig.classes} ${className}`}
      >
        {showPulse && (
          <span className={`relative flex ${sizeConfig.dotSize}`}>
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`}
            />
            <span
              className={`relative inline-flex rounded-full ${sizeConfig.dotSize} ${dotColor}`}
            />
          </span>
        )}
        {displayLabel}
      </div>
    );
  }
);

StatusBadge.displayName = "StatusBadge";

// Re-export types for convenience
export type { StatusBadgeProps, StatusType } from "./types";

export default StatusBadge;
