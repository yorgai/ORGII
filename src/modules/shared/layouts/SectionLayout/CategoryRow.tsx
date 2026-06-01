/**
 * CategoryRow
 *
 * Shared row for category breakdowns (storage, memory, child processes).
 * Dot indicator + label on the left, percentage + formatted value on the right,
 * with an optional actions slot.
 */
import React from "react";

import StatusDot from "@src/components/StatusDot";

export interface CategoryRowProps {
  /** Display label */
  label: string;
  /** Percentage string (e.g. "12.3"). Omit to hide percentage. */
  percentage?: string;
  /** Formatted value string (e.g. "1.2 GB") */
  formattedValue: string;
  /** Whether this row represents an active/non-zero entry */
  isActive?: boolean;
  /** Optional action buttons rendered after the value */
  actions?: React.ReactNode;
}

const CategoryRow: React.FC<CategoryRowProps> = ({
  label,
  percentage,
  formattedValue,
  isActive = true,
  actions,
}) => {
  return (
    <div className="flex items-center justify-between py-1.5">
      <StatusDot
        color={isActive ? "bg-primary-6" : "bg-fill-3"}
        size="sm"
        labelClassName={`text-xs ${isActive ? "text-text-2" : "text-text-3"}`}
        label={label}
      />
      <div className="flex items-center gap-2">
        {percentage !== undefined && (
          <span className="text-xs text-text-3">{percentage}%</span>
        )}
        <span className="min-w-[60px] text-right text-xs text-text-2">
          {formattedValue}
        </span>
        {actions}
      </div>
    </div>
  );
};

export default CategoryRow;
