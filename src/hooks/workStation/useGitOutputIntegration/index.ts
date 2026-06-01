/**
 * Git Output Integration
 *
 * Re-exports for the git output integration hook.
 */

// Main hook
export { useGitOutputIntegration } from "./useGitOutputIntegration";

// Types
export type {
  GitOperationResult,
  UseGitOutputIntegrationOptions,
  UseGitOutputIntegrationReturn,
} from "./types";

// Sub-hooks (for advanced usage)
export { useGitOperations } from "./useGitOperations";
export { useGitStagingOperations } from "./useGitStagingOperations";
export { useFileWatchHeartbeat } from "./useFileWatchHeartbeat";

// Utilities (for testing/extension)
export { formatTimestamp, formatTimestampFromDate } from "./formatters";
