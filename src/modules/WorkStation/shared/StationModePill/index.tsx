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

import SegmentedIconButton from "@src/components/SegmentedIconButton";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { ROUTES } from "@src/config/routes";
import { GENERAL_LAYOUT_TOUR_TARGETS } from "@src/scaffold/Tutorials/GeneralLayoutTour";
import { type StationMode, stationModeAtom } from "@src/store/ui/simulatorAtom";

import { WorkstationToolbarTooltip } from "../WorkstationToolbarTooltip";

const MY_STATION_SHORTCUT_ID = "open_my_station";
const AGENT_STATION_SHORTCUT_ID = "open_agent_station";
const OPS_CONTROL_SHORTCUT_ID = "open_ops_control";

const SELECTED_STATION_BUTTON_STYLE: React.CSSProperties = {
  boxShadow: "var(--sidebar-tab-pill-selected-shadow)",
};

interface IconSwitchButtonProps {
  label: string;
  tooltipLabel: string;
  selected: boolean;
  onClick: () => void;
  icon: LucideIcon;
  testId?: string;
  shortcut: string;
}

const IconSwitchButton: React.FC<IconSwitchButtonProps> = ({
  label,
  tooltipLabel,
  selected,
  onClick,
  icon: Icon,
  testId,
  shortcut,
}) => {
  const buttonSizeClass = "h-[28px] w-[42px]";

  return (
    <WorkstationToolbarTooltip
      label={tooltipLabel}
      shortcut={shortcut || undefined}
      position="bottom"
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
          selectedClassName="bg-fill-2 text-text-1"
          unselectedClassName="bg-transparent text-text-2 hover:bg-fill-2 hover:text-text-1"
          className="flex-shrink-0"
          style={selected ? SELECTED_STATION_BUTTON_STYLE : undefined}
          transitionClassName="transition-[background-color,color,box-shadow] duration-150"
          strokeWidth={1.85}
        />
      </span>
    </WorkstationToolbarTooltip>
  );
};

const StationModePill: React.FC = () => {
  const [stationMode, setStationMode] = useAtom(stationModeAtom);
  const navigate = useNavigate();
  const location = useLocation();

  const { t } = useTranslation("common");
  const mySegment = t("terminology.myStation");
  const agentSegment = t("terminology.agentStation");
  const opsControlSegment = t("navigation:routes.opsControl");

  const myStationShortcut = getShortcutKeys(MY_STATION_SHORTCUT_ID);
  const agentStationShortcut = getShortcutKeys(AGENT_STATION_SHORTCUT_ID);
  const opsControlShortcut = getShortcutKeys(OPS_CONTROL_SHORTCUT_ID);
  const activeStationMode = stationMode;

  const handleChange = useCallback(
    (mode: StationMode) => {
      setStationMode(mode);

      if (mode === "ops-control") {
        if (location.pathname !== ROUTES.workStation.opsControl.path) {
          navigate(ROUTES.workStation.opsControl.path);
        }
        return;
      }

      if (location.pathname === ROUTES.workStation.opsControl.path) {
        navigate(ROUTES.workStation.base.path);
      }
    },
    [location.pathname, navigate, setStationMode]
  );

  return (
    <div
      className="flex items-center gap-1"
      data-tour-target={GENERAL_LAYOUT_TOUR_TARGETS.stationModePill}
    >
      {activeStationMode === "ops-control" && (
        <IconSwitchButton
          label={opsControlSegment}
          tooltipLabel={t("actions.switchToStation", {
            station: opsControlSegment,
          })}
          icon={Radar}
          selected
          onClick={() => handleChange("ops-control")}
          testId="station-mode-ops-control"
          shortcut={opsControlShortcut}
        />
      )}
      <IconSwitchButton
        label={mySegment}
        tooltipLabel={t("actions.switchToStation", { station: mySegment })}
        icon={Laptop}
        selected={activeStationMode === "my-station"}
        onClick={() => handleChange("my-station")}
        testId="station-mode-my-station"
        shortcut={myStationShortcut}
      />
      <IconSwitchButton
        label={agentSegment}
        tooltipLabel={t("actions.switchToStation", { station: agentSegment })}
        icon={Infinity}
        selected={activeStationMode === "agent-station"}
        onClick={() => handleChange("agent-station")}
        testId="station-mode-agent-station"
        shortcut={agentStationShortcut}
      />
    </div>
  );
};

export default StationModePill;
