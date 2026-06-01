/**
 * Dock Component
 *
 * Pure macOS-style dock bar — LiquidGlass pill with app icons.
 * Used by both My Station and Agent Station with different app lists.
 */
import type { LucideIcon } from "lucide-react";
import React, { memo } from "react";

import {
  DOCK_LUCIDE_ICON_PROPS,
  DockIconColumn,
  DockSegmentDivider,
  StationDockGlassPill,
  StationDockRow,
  dockIconHitAreaClassName,
} from "./dockLayout";

// ============================================
// Types
// ============================================

export interface DockAppItem {
  id: string;
  name: string;
  icon: LucideIcon;
}

interface DockProps {
  /**
   * Segments left-to-right; a vertical separator is drawn between consecutive segments.
   * Example: `[[chat], [code, browser, database]]` → Chat | others
   */
  segments: DockAppItem[][];
  activeApp: string | null;
  onAppClick?: (appId: string) => void;
}

// ============================================
// Component
// ============================================

export const Dock: React.FC<DockProps> = memo(
  ({ segments, activeApp, onAppClick }) => (
    <StationDockRow layout="centered">
      <StationDockGlassPill>
        {segments.map((segment, segmentIndex) => (
          <React.Fragment key={segmentIndex}>
            {segmentIndex > 0 && <DockSegmentDivider />}
            {segment.map((app) => {
              const isActive = activeApp === app.id;
              return (
                <DockIconColumn key={app.id} trailer="spacer">
                  <div
                    className={dockIconHitAreaClassName({ active: isActive })}
                    onClick={() => onAppClick?.(app.id)}
                    title={app.name}
                  >
                    {React.createElement(app.icon, DOCK_LUCIDE_ICON_PROPS)}
                  </div>
                </DockIconColumn>
              );
            })}
          </React.Fragment>
        ))}
      </StationDockGlassPill>
    </StationDockRow>
  )
);

Dock.displayName = "Dock";
