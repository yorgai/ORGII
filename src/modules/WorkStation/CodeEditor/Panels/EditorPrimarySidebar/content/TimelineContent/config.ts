/**
 * TimelineSection Configuration
 */
import { Diff, GitCommit, Pin, RefreshCw } from "lucide-react";

// Icon configuration
export const TIMELINE_ICONS = {
  commit: GitCommit,
  pin: Pin,
  refresh: RefreshCw,
  openDiff: Diff,
} as const;

// Constants
export const TIMELINE_CONSTANTS = {
  MAX_COMMITS: 50,
  ICON_SIZE: 12,
  ACTION_ICON_SIZE: 14,
  ENTRY_HEIGHT: 56,
} as const;
