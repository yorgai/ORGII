/**
 * LayoutButtons Component
 *
 * Display type selector (block, flex, grid, inline) as full-width TabPill.
 */
import { LayoutGrid, Minus, Rows2, Square } from "lucide-react";
import React, { memo, useMemo } from "react";

import TabPill, { type TabPillItem } from "@src/components/TabPill";

// ============================================
// Types
// ============================================

export interface LayoutButtonsProps {
  /** Current display value */
  currentDisplay: string;
  /** Handler for display change */
  onDisplayChange: (display: string) => void;
  /** Whether buttons are disabled */
  disabled?: boolean;
}

// ============================================
// Constants
// ============================================

const DISPLAY_OPTIONS = [
  { value: "block", label: "Block", icon: Square },
  { value: "flex", label: "Flex", icon: Rows2 },
  { value: "grid", label: "Grid", icon: LayoutGrid },
  { value: "inline", label: "Inline", icon: Minus },
] as const;

// ============================================
// Component
// ============================================

export const LayoutButtons: React.FC<LayoutButtonsProps> = memo(
  ({ currentDisplay, onDisplayChange, disabled = false }) => {
    const normalizedDisplay = currentDisplay.toLowerCase().split(" ")[0];

    const activeTab =
      DISPLAY_OPTIONS.find((option) => option.value === normalizedDisplay)
        ?.value ?? "";

    const tabs: TabPillItem[] = useMemo(
      () =>
        DISPLAY_OPTIONS.map((option) => {
          const Icon = option.icon;
          return {
            key: option.value,
            label: option.label,
            icon: <Icon size={14} strokeWidth={1.75} className="shrink-0" />,
            disabled,
          };
        }),
      [disabled]
    );

    return (
      <TabPill
        variant="pill"
        color="fill"
        size="small"
        fillWidth
        wrap
        className="w-full min-w-0"
        tabs={tabs}
        activeTab={activeTab}
        onChange={onDisplayChange}
      />
    );
  }
);

LayoutButtons.displayName = "LayoutButtons";

export default LayoutButtons;
