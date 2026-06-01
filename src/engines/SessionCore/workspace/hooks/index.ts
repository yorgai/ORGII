/**
 * Workspace Hooks Index
 *
 * Re-exports all workspace hooks.
 * These replace the context hooks from contexts/workspace/.
 */

// Session hooks (replaces useSessionContext)
export {
  useWorkspaceSession,
  useSessionShow,
  useTaskStatus,
  useRepositoryInfo,
} from "./useWorkspaceSession";

// UI hooks (replaces useUIContext)
export {
  useWorkspaceUI,
  useCenterTab,
  usePageLoading,
  useActiveView,
} from "./useWorkspaceUI";

// Note: Chat/Socket hooks were removed (2026-03-30) as they duplicated
// ChatContext/SocketContext. Use useChatContext() from contexts/workspace/
// for chat UI state instead.
