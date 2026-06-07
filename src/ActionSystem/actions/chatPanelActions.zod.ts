import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import {
  activeStationChatVisibleAtom,
  chatTurnPaginationEnabledAtom,
  modelPickerStyleAtom,
} from "@src/store/ui/chatPanelAtom";
import { stationModeAtom } from "@src/store/ui/simulatorAtom";
import {
  sessionChatPositionAtom,
  workStationChatPositionAtom,
  workStationDockAutoHidePersistAtom,
  workStationInternalLayoutModePersistAtom,
  workStationLayoutModePersistAtom,
} from "@src/store/ui/workStationAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const emptyParams = z.object({});

type ChatPanelPosition = "left" | "right";
type InternalLayoutMode = "comfort" | "compact";
type ModelPickerStyle = "spotlight" | "dropdown";

function showActiveStationChatIfNeeded(): void {
  const store = getInstrumentedStore();
  const stationMode = store.get(stationModeAtom);
  if (stationMode === "my-station" || stationMode === "agent-station") {
    store.set(activeStationChatVisibleAtom, stationMode, true);
  }
}

function defineEmptyAction(
  id: string,
  category: "settings" | "view",
  description: string,
  message: string,
  examples: string[],
  execute: () => void
) {
  return defineZodAction(
    {
      id,
      category,
      description,
      params: emptyParams,
      layer: "gui",
      examples,
    },
    async () => {
      execute();
      return { success: true, message };
    }
  );
}

function setMyStationChatPosition(position: ChatPanelPosition): void {
  const store = getInstrumentedStore();
  showActiveStationChatIfNeeded();
  store.set(workStationChatPositionAtom, position);
}

function setAgentStationChatPosition(position: ChatPanelPosition): void {
  const store = getInstrumentedStore();
  store.set(sessionChatPositionAtom, position);
}

function setModelPickerStyle(style: ModelPickerStyle): void {
  const store = getInstrumentedStore();
  store.set(modelPickerStyleAtom, style);
}

function setInternalLayoutMode(mode: InternalLayoutMode): void {
  const store = getInstrumentedStore();
  store.set(workStationInternalLayoutModePersistAtom, mode);
}

const chatPanelSetMyStationLeft = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_SET_MY_STATION_LEFT,
  "settings",
  "Move the My Station chat panel to the left",
  "My Station chat panel moved left",
  ["move my station chat left", "put chat panel on the left"],
  () => setMyStationChatPosition("left")
);

const chatPanelSetMyStationRight = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_SET_MY_STATION_RIGHT,
  "settings",
  "Move the My Station chat panel to the right",
  "My Station chat panel moved right",
  ["move my station chat right", "put chat panel on the right"],
  () => setMyStationChatPosition("right")
);

const chatPanelSetAgentStationLeft = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_SET_AGENT_STATION_LEFT,
  "settings",
  "Move the Agent Station chat panel to the left",
  "Agent Station chat panel moved left",
  ["move agent station chat left", "put agent chat on the left"],
  () => setAgentStationChatPosition("left")
);

const chatPanelSetAgentStationRight = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_SET_AGENT_STATION_RIGHT,
  "settings",
  "Move the Agent Station chat panel to the right",
  "Agent Station chat panel moved right",
  ["move agent station chat right", "put agent chat on the right"],
  () => setAgentStationChatPosition("right")
);

const chatPanelEnablePagination = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_ENABLE_PAGINATION,
  "settings",
  "Enable turn pagination in the chat panel",
  "Chat panel pagination enabled",
  ["enable chat pagination", "turn on chat rounds", "paginate chat turns"],
  () => {
    const store = getInstrumentedStore();
    store.set(chatTurnPaginationEnabledAtom, true);
  }
);

const chatPanelDisablePagination = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_DISABLE_PAGINATION,
  "settings",
  "Disable turn pagination in the chat panel",
  "Chat panel pagination disabled",
  ["disable chat pagination", "turn off chat rounds", "show continuous chat"],
  () => {
    const store = getInstrumentedStore();
    store.set(chatTurnPaginationEnabledAtom, false);
  }
);

const chatPanelUseModelPickerSpotlight = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_USE_MODEL_PICKER_SPOTLIGHT,
  "settings",
  "Use Spotlight for the chat panel model picker",
  "Model picker set to Spotlight",
  ["use spotlight model picker", "open models with spotlight"],
  () => setModelPickerStyle("spotlight")
);

const chatPanelUseModelPickerDropdown = defineEmptyAction(
  ACTION_ID.CHAT_PANEL_USE_MODEL_PICKER_DROPDOWN,
  "settings",
  "Use a dropdown menu for the chat panel model picker",
  "Model picker set to dropdown",
  ["use model picker dropdown", "use compact model picker menu"],
  () => setModelPickerStyle("dropdown")
);

const workstationSetComfortLayout = defineEmptyAction(
  ACTION_ID.WORKSTATION_SET_COMFORT_LAYOUT,
  "view",
  "Use the comfort workstation layout density",
  "Workstation layout set to comfort",
  ["use comfort layout", "make workstation comfortable"],
  () => setInternalLayoutMode("comfort")
);

const workstationSetCompactLayout = defineEmptyAction(
  ACTION_ID.WORKSTATION_SET_COMPACT_LAYOUT,
  "view",
  "Use the compact workstation layout density",
  "Workstation layout set to compact",
  ["use compact layout", "make workstation compact"],
  () => setInternalLayoutMode("compact")
);

const workstationSetSidebarLeft = defineEmptyAction(
  ACTION_ID.WORKSTATION_SET_SIDEBAR_LEFT,
  "view",
  "Move the Workstation sidebar to the left",
  "Workstation sidebar moved left",
  ["move workstation sidebar left", "sidebar on the left"],
  () => {
    const store = getInstrumentedStore();
    store.set(workStationLayoutModePersistAtom, "left");
  }
);

const workstationSetSidebarRight = defineEmptyAction(
  ACTION_ID.WORKSTATION_SET_SIDEBAR_RIGHT,
  "view",
  "Move the Workstation sidebar to the right",
  "Workstation sidebar moved right",
  ["move workstation sidebar right", "sidebar on the right"],
  () => {
    const store = getInstrumentedStore();
    store.set(workStationLayoutModePersistAtom, "right");
  }
);

const workstationEnableDockAutoHide = defineEmptyAction(
  ACTION_ID.WORKSTATION_ENABLE_DOCK_AUTO_HIDE,
  "view",
  "Enable Workstation dock auto-hide",
  "Dock auto-hide enabled",
  ["enable dock auto hide", "auto hide dock"],
  () => {
    const store = getInstrumentedStore();
    store.set(workStationDockAutoHidePersistAtom, true);
  }
);

const workstationDisableDockAutoHide = defineEmptyAction(
  ACTION_ID.WORKSTATION_DISABLE_DOCK_AUTO_HIDE,
  "view",
  "Disable Workstation dock auto-hide",
  "Dock auto-hide disabled",
  ["disable dock auto hide", "keep dock visible"],
  () => {
    const store = getInstrumentedStore();
    store.set(workStationDockAutoHidePersistAtom, false);
  }
);

export const chatPanelZodActions = [
  chatPanelSetMyStationLeft,
  chatPanelSetMyStationRight,
  chatPanelSetAgentStationLeft,
  chatPanelSetAgentStationRight,
  chatPanelEnablePagination,
  chatPanelDisablePagination,
  chatPanelUseModelPickerSpotlight,
  chatPanelUseModelPickerDropdown,
  workstationSetComfortLayout,
  workstationSetCompactLayout,
  workstationSetSidebarLeft,
  workstationSetSidebarRight,
  workstationEnableDockAutoHide,
  workstationDisableDockAutoHide,
];

export const chatPanelActionRegistration =
  defineAppActionRegistration(chatPanelZodActions);
