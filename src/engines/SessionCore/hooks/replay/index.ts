/**
 * Replay & Navigation Hooks
 *
 * Hooks for session replay, step navigation, file tracking.
 */

// Replay state
export {
  useReplayBarState,
  useReplayState,
  useReplayTime,
} from "./useReplayState";
export type { UseReplayStateReturn, WpTimeRange } from "./useReplayState";

// Step state
export { useStepState } from "./useStepState";
export type { UseStepStateReturn } from "./useStepState";

// File tracking
export { useRecentFiles, type UseRecentFilesReturn } from "./useRecentFiles";
export { useRecentFilesForEvent } from "./useRecentFilesForEvent";

// Planning indicator
export { usePlanningIndicator } from "./usePlanningIndicator";
export type { PlanningIndicatorState } from "./usePlanningIndicator";
