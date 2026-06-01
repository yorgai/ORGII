import React, { forwardRef } from "react";

interface NoDragRegionProps {
  children: React.ReactNode;
  className?: string;
}

const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export const NoDragRegion = forwardRef<HTMLDivElement, NoDragRegionProps>(
  ({ children, className }, ref) => (
    <div ref={ref} className={className} style={NO_DRAG_STYLE}>
      {children}
    </div>
  )
);

NoDragRegion.displayName = "NoDragRegion";

export default NoDragRegion;
