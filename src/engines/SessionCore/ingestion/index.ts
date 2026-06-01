/**
 * Session Ingestion
 *
 * Data normalization and processing for session events.
 * Transforms raw backend chunks into normalized SessionEvent objects.
 */

// Rust bridge - Tauri IPC for chunk processing
export {
  processChunksRust,
  normalizeChunkRust,
  setEventStoreRepoContext,
} from "./rustBridge";

// Agent message adapters - OS/SDE agent message conversion
export type {
  AgentMessageBase,
  PersistedMessage,
} from "./agentMessageAdapters";
export {
  persistedMessageToSessionEvent,
  mergeToolResults,
} from "./agentMessageAdapters";

// Visibility filters - event filtering for UI contexts
// NOTE: normalizeChunk/normalizeChunks have been archived — use rustBridge instead
export {
  stripTerminalCodeBlocks,
  isVisibleInChat,
  isVisibleInSimulator,
  isVisibleInMessages,
} from "./visibilityFilters";
