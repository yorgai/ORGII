/**
 * Session Creator Configuration
 *
 * Centralized configuration for session creation feature
 */
// Shared types and config arrays (consumed by both SessionCreator and ChatPanel)
export type {
  AgentExecMode,
  AgentExecModeEntry,
  RunningLocation,
  RunningLocationEntry,
} from "@src/config/sessionCreatorConfig";
export {
  SESSION_CONFIG,
  DEFAULT_AGENT_EXEC_MODE,
  AGENT_EXEC_MODES,
  getAgentExecModeEntry,
  DEFAULT_RUNNING_LOCATION,
  RUNNING_LOCATIONS,
} from "@src/config/sessionCreatorConfig";

// ============================================
// Icon Configuration
// ============================================

export const ICON_CONFIG = {
  upload: "Upload",
  loader: "Loader2",
  arrowUp: "ArrowUp",
  list: "List",
  grid: "LayoutGrid",
  file: "File",
  image: "Image",
  folder: "Folder",
  fileText: "FileText",
  code: "Code",
  delete: "Trash2",
  gitBranch: "GitBranch",
  myKeys: "Lock",
  hostedKeys: "Store",
  check: "Check",
} as const;

// ============================================
// Default Branch Options
// ============================================

export const DEFAULT_BRANCH_OPTIONS = [
  { label: "main", value: "main" },
  { label: "master", value: "master" },
] as const;
