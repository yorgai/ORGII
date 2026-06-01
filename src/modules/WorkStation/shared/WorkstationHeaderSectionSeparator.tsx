import React, { memo } from "react";

interface WorkstationHeaderSectionSeparatorProps {
  className?: string;
}

const WorkstationHeaderSectionSeparatorComponent: React.FC<
  WorkstationHeaderSectionSeparatorProps
> = ({ className = "" }) => (
  <span
    className={`pointer-events-none h-4 w-px shrink-0 bg-border-2 ${className}`.trim()}
    aria-hidden
  />
);

export const WorkstationHeaderSectionSeparator = memo(
  WorkstationHeaderSectionSeparatorComponent
);
WorkstationHeaderSectionSeparator.displayName =
  "WorkstationHeaderSectionSeparator";
