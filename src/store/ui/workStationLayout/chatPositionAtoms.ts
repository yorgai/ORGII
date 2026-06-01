import { atom } from "jotai";

import { settingsAtom, updateSettingAtom } from "@src/store/settings";

export type ChatPanelPosition = "left" | "right";

export const workStationChatPositionAtom = atom(
  (get) =>
    get(settingsAtom)["general.workStationChatPosition"] as ChatPanelPosition,
  (_get, set, value: ChatPanelPosition) => {
    set(updateSettingAtom, {
      key: "general.workStationChatPosition",
      value,
    });
  }
);
workStationChatPositionAtom.debugLabel = "workStationChatPosition";

export const sessionChatPositionAtom = atom(
  (get) =>
    get(settingsAtom)["general.sessionChatPosition"] as ChatPanelPosition,
  (_get, set, value: ChatPanelPosition) => {
    set(updateSettingAtom, {
      key: "general.sessionChatPosition",
      value,
    });
  }
);
sessionChatPositionAtom.debugLabel = "sessionChatPosition";
