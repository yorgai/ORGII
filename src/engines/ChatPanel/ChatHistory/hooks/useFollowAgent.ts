/**
 * useFollowAgent
 *
 * Determines whether the "Follow Agent" button should be shown
 * (workStation view, my-station mode) and provides the click handler
 * that flips into agent-station + follow replay mode.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import { replayModeAtom } from "@src/engines/SessionCore";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

const STATION_MODE_SHORTCUT_ID = "toggle_station_mode";

export interface UseFollowAgentReturn {
  showFollowAgent: boolean;
  followAgentLabel: string;
  followAgentTooltipLabel: string;
  followAgentShortcut: string;
  handleFollowAgent: () => void;
}

export function useFollowAgent(): UseFollowAgentReturn {
  const { t } = useTranslation(["sessions", "common"]);
  const viewMode = useRouteViewMode();
  const stationMode = useAtomValue(stationModeAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setReplayMode = useSetAtom(replayModeAtom);

  const showFollowAgent =
    viewMode === "workStation" && stationMode === "my-station";
  const agentStationLabel = t("common:terminology.agentStation");

  const handleFollowAgent = useCallback(() => {
    setStationMode("agent-station");
    setReplayMode("follow");
  }, [setStationMode, setReplayMode]);

  return {
    showFollowAgent,
    followAgentLabel: t("chat.replay.follow"),
    followAgentTooltipLabel: t("common:actions.switchToStation", {
      station: agentStationLabel,
    }),
    followAgentShortcut: getShortcutKeys(STATION_MODE_SHORTCUT_ID),
    handleFollowAgent,
  };
}
