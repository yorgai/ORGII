import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";

async function getAppViewService() {
  const { AppViewService } = await import("@src/services/app");
  return AppViewService;
}

export const sidebarToggle = defineZodAction(
  {
    id: ACTION_ID.SIDEBAR_TOGGLE,
    category: "sidebar",
    description: "Toggle the App Sidebar between collapsed and expanded",
    params: z.object({}),
    layer: "gui",
    tags: ["app-sidebar", "sidebar", "view"],
    examples: ["toggle app sidebar", "hide app sidebar", "show app sidebar"],
  },
  async () => {
    const appViewService = await getAppViewService();
    const success = await appViewService.toggleSidebar();
    return success
      ? { success: true, message: "Toggled sidebar" }
      : { success: false, message: "Sidebar is not available" };
  }
);

export const agentStationCreateSession = defineZodAction(
  {
    id: ACTION_ID.AGENT_STATION_CREATE_SESSION,
    category: "session",
    description:
      "Create a new Agent Station session by closing the active session and opening Agent Station",
    params: z.object({}),
    layer: "gui",
    tags: ["agent-station", "session", "navigation"],
    examples: [
      "create a new agent session",
      "start a new session",
      "open Agent Station",
    ],
  },
  async () => {
    const appViewService = await getAppViewService();
    const success = await appViewService.createAgentStationSession();
    return success
      ? { success: true, message: "Opened Agent Station for a new session" }
      : { success: false, message: "Agent Station is not available" };
  }
);

export const appViewZodActions = [sidebarToggle, agentStationCreateSession];
