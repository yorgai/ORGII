/**
 * ActionSystem — App-Wide Action Dispatch
 *
 * Central action system for the entire application. Actions are Zod-validated,
 * type-safe, and dispatchable from any source (user click, AI agent, system).
 *
 * Architecture:
 * - `src/ActionSystem/` — Core schema, registry, app-level actions (this module)
 * - `src/modules/WorkStation/ActionSystem/` — WorkStation-specific actions + provider
 *
 * Both register into the same global `zodActionRegistry` singleton.
 *
 * App-level action categories: app, sidebar, spotlight
 * WorkStation categories: file, editor, search, test, panel, terminal, git, view, navigation
 */

// Schema system
export {
  defineZodAction,
  zodActionToLLMTool,
  type ActionCategory,
  type ActionExecutor,
  type ActionLayer,
  type ActionMeta,
  type ActionParams,
  type ActionResult,
  type LLMToolDefinition,
  type ZodAction,
} from "./schema/defineZodAction";

export { zodActionRegistry } from "./schema/zodRegistry";

// App-level actions
export { appNavigationZodActions } from "./actions/navigationActions.zod";
export { sidebarZodActions } from "./actions/sidebarActions.zod";
export { spotlightZodActions } from "./actions/spotlightActions.zod";

// Registration
export { registerAppActions } from "./registerAppActions";
