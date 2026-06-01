/**
 * ActionSystem Public Exports
 *
 * WorkStation-specific entry points into the unified action dispatch system.
 * The core schema, registry, and app-level registration live under
 * `src/ActionSystem/`; this barrel surfaces only the pieces WorkStation
 * consumers need.
 */

export {
  ActionSystemProvider,
  useActionSystem,
  useActionSystemOptional,
} from "./ActionSystemContext";

export { ACTION_ID, type ActionId } from "./actionIds";
export type { ActionResult } from "./types";

export { zodActionRegistry } from "./schema/zodRegistry";

export {
  initializeServices,
  registerCoreActions,
} from "./registration/registerCoreActions";
