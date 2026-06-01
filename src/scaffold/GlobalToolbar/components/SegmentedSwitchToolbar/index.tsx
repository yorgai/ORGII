import React from "react";

import ToolbarGlassContainer from "../ToolbarGlassContainer";

interface SegmentedSwitchToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export const SegmentedSwitchToolbar: React.FC<SegmentedSwitchToolbarProps> = ({
  children,
  className = "",
}) => (
  <ToolbarGlassContainer chrome="segmentedSwitch" className={className}>
    {children}
  </ToolbarGlassContainer>
);

export default SegmentedSwitchToolbar;
