/**
 * ViewModeSwitch Component
 *
 * A switch for toggling between App View and Workstation view modes.
 * Uses SegmentedSwitchToolbar with simple button children.
 */
import { LayoutGrid, SquareMousePointer } from "lucide-react";
import React from "react";

import SegmentedSwitchToolbar from "../SegmentedSwitchToolbar";
import { SwitchButton } from "../SwitchButton";

// ============================================
// Types
// ============================================

export type ViewMode = "mainApp" | "workStation";

export interface ViewModeSwitchProps {
  /** Current selected view mode */
  value: ViewMode;
  /** Callback when view mode changes */
  onChange: (mode: ViewMode) => void;
  /** Additional className for the container */
  className?: string;
}

// ============================================
// Component
// ============================================

export const ViewModeSwitch: React.FC<ViewModeSwitchProps> = ({
  value,
  onChange,
  className = "",
}) => {
  return (
    <SegmentedSwitchToolbar className={className}>
      <SwitchButton
        key="mainApp"
        icon={LayoutGrid}
        onClick={() => onChange("mainApp")}
        title="App View"
        selected={value === "mainApp"}
      />
      <SwitchButton
        key="workStation"
        icon={SquareMousePointer}
        onClick={() => onChange("workStation")}
        title="Workstation"
        selected={value === "workStation"}
      />
    </SegmentedSwitchToolbar>
  );
};

export default ViewModeSwitch;
