/**
 * Session Store
 *
 * Centralized session state management including:
 * - Agent sessions (via local Rust backend)
 * - Session view navigation
 * - Session creator state and drafts
 * - Session history filters
 */

// Types
export type { SessionViewState } from "./types";

// My_key sessions
export * from "./sessionAtom";

// Session view navigation
export * from "./viewAtom";
export * from "./visitedSessionsAtom";

// Session creator
export * from "./creatorStateAtom";
export * from "./creatorDraftAtom";
export * from "./creatorDefaultModelAtom";
export * from "./recentModelEntriesAtom";
export * from "./creatorDefaultExecModeAtom";

// Session runtime (engine lifecycle, file review, shell processes)
export * from "./cliSessionStatusAtom"; // Contains sessionRuntimeStatusAtom, etc.
export * from "./fileReviewAtom";
export * from "./shellProcessAtom";

// Cursor IDE per-session model picker scratch space
export * from "./cursorModelOverrideAtom";
export * from "./cursorModeOverrideAtom";

export * from "./agentRegistryAtom";
export * from "./canvasPreviewAtom";
export * from "./cursorIdeTurnSummariesAtom";
export * from "./mcpProgressAtom";
export * from "./planApprovalAtom";
export * from "./runningLocationAtom";
export * from "./selectedWorktreePathAtom";
