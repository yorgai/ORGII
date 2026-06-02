/**
 * StationModePill Component
 *
 * Renders the My Station / Agent's Station icon segmented toggle.
 */
import { useAtom } from "jotai";
import { Infinity, Laptop, type LucideIcon, Radar } from "lucide-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/GeneralLayoutTour";
import { type StationMode, stationModeAtom } from "@src/store/ui/simulatorAtom";

import SegmentedIconButton from "../SegmentedIconButton";

const STATION_MODE_SHORTCUT_ID = "toggle_station_mode";

interface IconSwitchButtonProps {
  label: string;
  tooltipLabel: string;
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  testId?: string;
  shortcut: string;
  selectedClassName?: string;
}

const IconSwitchButton: React.FC<IconSwitchButtonProps> = ({
  label,
  tooltipLabel,
  selected,
  onClick,
  icon: Icon,
  testId,
  shortcut,
  selectedClassName = "bg-primary-6 text-white",
}) => {
  const buttonSizeClass = "h-6 w-7";

  return (
    <Tooltip
      content={
        <KeyboardShortcutTooltipContent
          label={tooltipLabel}
          shortcut={shortcut || undefined}
        />
      }
      position="bottom"
      mouseEnterDelay={250}
      framedPanel
    >
      <span className="inline-flex">
        <SegmentedIconButton
          icon={Icon}
          selected={selected}
          onClick={onClick}
          ariaLabel={label}
          ariaPressed={selected}
          testId={testId}
          sizeClassName={buttonSizeClass}
          selectedClassName={selectedClassName}
          unselectedClassName="bg-transparent text-text-1 hover:bg-fill-3"
          transitionClassName="transition-colors duration-150"
          strokeWidth={1.85}
        />
      </span>
    </Tooltip>
  );
};

const StationModePill: React.FC = () => {
  const [stationMode, setStationMode] = useAtom(stationModeAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const { t } = useTranslation("common");
  const mySegment = t("terminology.myStation");
  const agentSegment = t("terminology.agentStation");
  const kanbanSegment = t("navigation:routes.kanban");

  const shortcut = getShortcutKeys(STATION_MODE_SHORTCUT_ID);
  const activeStationMode = stationMode;

  const handleChange = useCallback(
    (mode: StationMode) => {
      setStationMode(mode);

      if (mode === "ops-control") {
        if (location.pathname !== ROUTES.workStation.kanban.path) {
          navigate(ROUTES.workStation.kanban.path);
        }
        return;
      }

      if (location.pathname === ROUTES.workStation.kanban.path) {
        navigate(ROUTES.workStation.base.path);
      }
    },
    [location.pathname, navigate, setStationMode]
  );

  return (
    <div
      className="flex items-center gap-px rounded-[100px] border border-border-2 bg-fill-1 p-0.5"
      data-tour-target={GENERAL_LAYOUT_TOUR_TARGETS.stationModePill}
    >
      {activeStationMode === "ops-control" && (
        <IconSwitchButton
          label={kanbanSegment}
          tooltipLabel={t("actions.switchToStation", {
            station: kanbanSegment,
          })}
          icon={Radar}
          selected
          onClick={() => handleChange("ops-control")}
          testId="station-mode-kanban"
          shortcut={shortcut}
          selectedClassName="bg-warning-6 text-white"
        />
      )}
      <IconSwitchButton
        label={mySegment}
        tooltipLabel={t("actions.switchToStation", { station: mySegment })}
        icon={Laptop}
        selected={activeStationMode === "my-station"}
        onClick={() => handleChange("my-station")}
        testId="station-mode-my-station"
        shortcut={shortcut}
      />
      <IconSwitchButton
        label={agentSegment}
        tooltipLabel={t("actions.switchToStation", { station: agentSegment })}
        icon={Infinity}
        selected={activeStationMode === "agent-station"}
        onClick={() => handleChange("agent-station")}
        testId="station-mode-agent-station"
        shortcut={shortcut}
      />
    </div>
  );
};

export default StationModePill;
