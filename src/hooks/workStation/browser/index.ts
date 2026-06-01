/**
 * Browser-specific hooks for WorkStation
 *
 * These hooks are specific to the Browser tool (web browser, designer).
 * Note: useBrowserPaneState is exported first to avoid circular dependency issues
 */
export { useBrowserPaneState } from "./useBrowserPaneState";
export type { UseBrowserPaneStateReturn } from "./useBrowserPaneState";

// useBrowserSessions has external dependencies, exported last
export { useBrowserSessions } from "./useBrowserSessions";
export type { UseBrowserSessionsReturn } from "./useBrowserSessions";
