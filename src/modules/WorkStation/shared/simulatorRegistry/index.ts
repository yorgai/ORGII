/**
 * Simulator App Registry
 *
 * Hosts the registry (which maps AppType -> lazy-loaded WorkStation components)
 * and the renderer hook. Pure framework types/hooks remain in
 * engines/Simulator/apps/core/.
 */

export {
  SIMULATOR_APP_REGISTRY,
  getAppForEvent,
  getRegisteredApps,
  getSimulatorAppConfig,
  hasSimulatorApp,
} from "./registry";

export { useSimulatorAppRenderer } from "./useSimulatorAppRenderer";
export type {
  SimulatorAppRenderProps,
  UseSimulatorAppRendererReturn,
} from "./useSimulatorAppRenderer";
