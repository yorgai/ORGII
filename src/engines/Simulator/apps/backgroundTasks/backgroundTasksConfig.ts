/**
 * Background Tasks App Config
 *
 * Registered in the simulator app registry so that events routed to
 * BACKGROUND_TASKS (subagent tool calls) display the BackgroundTasksApp.
 */
import { AppType } from "../../types/appTypes";
import { defineSimulatorAppConfig } from "../core/configFactory";

export const BACKGROUND_TASKS_APP_CONFIG = defineSimulatorAppConfig({
  appType: AppType.BACKGROUND_TASKS,
  name: "Background Tasks",
  icon: "Layers",
  deriveState: () => ({}),
});
