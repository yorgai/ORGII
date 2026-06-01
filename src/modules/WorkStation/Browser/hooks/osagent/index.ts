/**
 * OS Agent Hooks
 *
 * Hooks for interacting with the osagent Rust backend.
 * Session sync is handled by the unified SessionSyncProvider.
 * Agent event types live in engines/SessionCore/sync/adapters/shared/.
 */

export { useOSAgentIDEActions } from "./useOSAgentIDEActions";
export { useBrowserAutomation } from "./useBrowserAutomation";
export type {
  UseBrowserAutomationOptions,
  UseBrowserAutomationReturn,
} from "./useBrowserAutomation";
