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

import { useRouteViewMode } from "@src/config/routeViewModeConfig";
import { replayModeAtom } from "@src/engines/SessionCore";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";

export interface UseFollowAgentReturn {
  showFollowAgent: boolean;
  followAgentLabel: string;
  handleFollowAgent: () => void;
}

export function useFollowAgent(): UseFollowAgentReturn {
  const { t } = useTranslation("sessions");
  const viewMode = useRouteViewMode();
  const stationMode = useAtomValue(stationModeAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setReplayMode = useSetAtom(replayModeAtom);

  const showFollowAgent =
    viewMode === "workStation" && stationMode === "my-station";

  const handleFollowAgent = useCallback(() => {
    setStationMode("agent-station");
    setReplayMode("follow");
  }, [setStationMode, setReplayMode]);

  return {
    showFollowAgent,
    followAgentLabel: t("chat.replay.followAgent"),
    handleFollowAgent,
  };
}
