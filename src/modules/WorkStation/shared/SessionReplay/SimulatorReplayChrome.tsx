import React, { memo } from "react";

import { classNames } from "@src/util/ui/classNames";

import { SimulatorTabBarLeading } from "../AppSwitcherWrappers";
import { type ReplayTab, ReplayTabBar } from "./ReplayTabBar";
import { SimulatorWorkstationTabHeader } from "./SimulatorWorkstationTabHeader";

export interface SimulatorReplayChromeProps {
  tabs: ReplayTab[];
  activeEventId: string | null;
  onTabClick: (eventId: string) => void;
  children: React.ReactNode;
  leadingSlot?: React.ReactNode;
  trailingSlot?: React.ReactNode;
  showSidebarToggle?: boolean;
  sidebarToggleDisabled?: boolean;
  showWorkstationTabHeader?: boolean;
  className?: string;
}

const SimulatorReplayChromeComponent: React.FC<SimulatorReplayChromeProps> = ({
  tabs,
  activeEventId,
  onTabClick,
  children,
  leadingSlot,
  trailingSlot,
  showSidebarToggle = true,
  sidebarToggleDisabled = false,
  showWorkstationTabHeader = true,
  className,
}) => {
  return (
    <div
      className={classNames("flex h-full min-h-0 w-full flex-col", className)}
    >
      <ReplayTabBar
        tabs={tabs}
        activeEventId={activeEventId}
        onTabClick={onTabClick}
        leadingSlot={leadingSlot ?? <SimulatorTabBarLeading />}
        trailingSlot={trailingSlot}
      />
      {showWorkstationTabHeader && (
        <SimulatorWorkstationTabHeader
          showSidebarToggle={showSidebarToggle}
          sidebarToggleDisabled={sidebarToggleDisabled}
        />
      )}
      {children}
    </div>
  );
};

export const SimulatorReplayChrome = memo(SimulatorReplayChromeComponent);
SimulatorReplayChrome.displayName = "SimulatorReplayChrome";

export default SimulatorReplayChrome;
