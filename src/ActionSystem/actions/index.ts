/**
 * App-Level Action Registration Modules (Zod-based)
 *
 * These actions are available globally across the entire application,
 * not scoped to WorkStation.
 */

// App Navigation
export { appNavigationZodActions } from "./navigationActions.zod";
// Sidebar
export { sidebarZodActions } from "./sidebarActions.zod";
// Spotlight
export { spotlightZodActions } from "./spotlightActions.zod";
