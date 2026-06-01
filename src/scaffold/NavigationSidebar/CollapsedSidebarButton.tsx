import { useAtomValue, useSetAtom } from "jotai";
import { PanelLeft } from "lucide-react";
import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { useIsCompactLayout } from "@src/modules/shared/layouts/useCompactLayout";
import { sidebarCollapsedAtom } from "@src/store/ui/sidebarAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  workStationPrimarySidebarCollapsedAtom,
  workStationPrimarySidebarCollapsedPersistAtom,
} from "@src/store/ui/workStationAtom";

const COLLAPSED_SIDEBAR_BUTTON_LEFT = 88;

const CollapsedSidebarButtonComponent: React.FC = () => {
  const { t } = useTranslation("sessions");
  const isCompactLayout = useIsCompactLayout();
  const stationMode = useAtomValue(stationModeAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const primarySidebarCollapsed = useAtomValue(
    workStationPrimarySidebarCollapsedAtom
  );
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);
  const setPrimarySidebarCollapsed = useSetAtom(
    workStationPrimarySidebarCollapsedPersistAtom
  );
  const controlsOpsControlSidebar = stationMode === "ops-control";
  const collapsed = controlsOpsControlSidebar
    ? primarySidebarCollapsed
    : sidebarCollapsed;

  const handleClick = useCallback(() => {
    if (controlsOpsControlSidebar) {
      setPrimarySidebarCollapsed("toggle");
      return;
    }
    setSidebarCollapsed(false);
  }, [
    controlsOpsControlSidebar,
    setPrimarySidebarCollapsed,
    setSidebarCollapsed,
  ]);

  if (!collapsed) return null;

  return (
    <div
      className="absolute z-20 flex -translate-y-1/2 items-center"
      data-collapsed-sidebar-button
      style={
        {
          left: COLLAPSED_SIDEBAR_BUTTON_LEFT,
          top: isCompactLayout ? "calc(50% + 4px)" : "50%",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties & { WebkitAppRegion: string }
      }
    >
      <Button
        htmlType="button"
        variant="tertiary"
        size="small"
        iconOnly
        onClick={handleClick}
        title={t("simulator.titleBar.showSidebar")}
        aria-label={t("simulator.titleBar.showSidebar")}
        icon={<PanelLeft size={16} strokeWidth={2} />}
      />
    </div>
  );
};

export const CollapsedSidebarButton = memo(CollapsedSidebarButtonComponent);
CollapsedSidebarButton.displayName = "CollapsedSidebarButton";
