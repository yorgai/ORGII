/**
 * ModelAvailabilityBadge
 *
 * Shared badge showing model availability across sources.
 * Displays: [provider icons] · count [dot]
 *
 * Wraps in Tooltip when `tooltipContent` is provided, showing per-source
 * breakdown on hover (used in Spotlight selectors).
 *
 * Usage:
 *   - UnifiedModelPalette (model step right content)
 */
import React, { memo } from "react";

import ModelIcon from "@src/components/ModelIcon";
import Tooltip from "@src/components/Tooltip";

export interface ModelAvailabilityBadgeProps {
  /** Number of user keys / accounts available */
  keyCount?: number;
  /** Agent types to display as provider icons */
  providerTypes?: string[];
  /** Tooltip content shown on hover; when absent, no tooltip is rendered */
  tooltipContent?: React.ReactNode;
  /** Icon size for provider icons */
  iconSize?: number;
}

const ModelAvailabilityBadge: React.FC<ModelAvailabilityBadgeProps> = memo(
  ({ keyCount = 0, providerTypes = [], tooltipContent, iconSize = 14 }) => {
    const dotColor = keyCount > 0 ? "bg-success-6" : "bg-danger-6";
    const textColor = keyCount > 0 ? "text-text-2" : "text-text-3";

    const badge = (
      <div className="flex items-center gap-1.5">
        {providerTypes.length > 0 && (
          <>
            {providerTypes.map((agentType) => (
              <ModelIcon
                key={agentType}
                agentType={agentType}
                size={iconSize}
              />
            ))}
            <span className="text-[11px] text-text-4">&middot;</span>
          </>
        )}

        <span
          className={`whitespace-nowrap text-[11px] tabular-nums ${textColor}`}
        >
          {keyCount}
        </span>
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`}
        />
      </div>
    );

    if (tooltipContent) {
      return (
        <Tooltip
          content={tooltipContent}
          panelStyle
          position="top"
          showArrow={false}
          mouseLeaveDelay={300}
        >
          {badge}
        </Tooltip>
      );
    }

    return badge;
  }
);

ModelAvailabilityBadge.displayName = "ModelAvailabilityBadge";

export default ModelAvailabilityBadge;
