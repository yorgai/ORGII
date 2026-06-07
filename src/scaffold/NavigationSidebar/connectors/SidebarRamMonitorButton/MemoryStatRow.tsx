import React from "react";

import type { MemoryStatRowProps } from "./types";

export const MemoryStatRow: React.FC<MemoryStatRowProps> = ({
  label,
  value,
  emphasized = false,
  tone,
  indentLevel = 0,
}) => {
  const textWeightClassName = emphasized ? "font-semibold" : "font-normal";
  const indentClassName =
    indentLevel === 1 ? "pl-3" : indentLevel === 2 ? "pl-6" : "";
  const valueToneClassName =
    tone === "success"
      ? "text-success-6"
      : tone === "muted"
        ? "text-text-2"
        : "text-text-1";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className={`min-w-0 ${indentClassName}`}>
        <div
          className={`truncate text-[12px] leading-[1.35] text-text-1 ${textWeightClassName}`}
        >
          {label}
        </div>
      </div>
      <div
        className={`shrink-0 text-right text-[12px] ${valueToneClassName} ${textWeightClassName}`}
      >
        {value}
      </div>
    </div>
  );
};
