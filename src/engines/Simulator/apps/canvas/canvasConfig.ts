/**
 * Canvas App Config
 *
 * Registered in the simulator app registry so that render_inline_canvas
 * events route to the CanvasApp simulator view.
 */
import { AppType } from "../../types/appTypes";
import { defineSimulatorAppConfig } from "../core/configFactory";

export const CANVAS_APP_CONFIG = defineSimulatorAppConfig({
  appType: AppType.CANVAS,
  name: "Canvas",
  icon: "Layout",
  deriveState: () => ({}),
});
