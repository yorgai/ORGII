/**
 * Shared Agent Adapter Utilities
 *
 * Re-exports types, event builders, parsers, and helpers used by all
 * agent session adapters. New adapters compose from these modules.
 */

// Types
export type {
  AgentMessage,
  AgentTokenUsage,
  AgentWSEvent,
  ExitPlanModeEvent,
  PermissionRequestEvent,
  PlanReadyForApprovalEvent,
  QuestionRequestEvent,
  StreamingInfo,
  StreamRefs,
  ToolCallDeltaBuffer,
} from "./types";

// Event factories + stream helpers
export {
  appendStreamDelta,
  finalizeStream,
  flushPendingStreamDeltas,
  makeAssistantEvent,
  makeErrorEvent,
  makeThinkingEvent,
  makeToolCallEvent,
  makeToolResultEvent,
  createSyntheticUserEvent,
  resetStreamRefs,
} from "./eventBuilders";

// Parsers (streaming args, think tags, shell detection)
export {
  extractThinkContent,
  isShellTool,
  parsePartialToolArgs,
  stripThinkTags,
} from "./streamingParsers";

// Helpers (subagent tracking, spawned session detection, stream content)
export {
  capStreamContent,
  findActiveSubagentCallIndex,
  findSubagentParentEventId,
  isSubagentSpawningTool,
  SPAWNED_SESSION_RE,
  SPAWNING_TOOLS_ARRAY,
} from "./subagentTracking";

// Subagent session store (in-memory buffer + live streaming + SQLite flush)
