/**
 * Terminal Service Exports
 */
export { killAgentShellProcess } from "./agentShellProcess";
export type { KillAgentShellProcessOptions } from "./agentShellProcess";
export { TerminalService } from "./TerminalService";
export type { SubprocessResult } from "./TerminalService";

export {
  clearAllPersistedBuffers,
  clearPersistedBuffer,
  flushPendingWrites,
  loadPersistedBuffers,
  persistTerminalBuffer,
  startAutoSave,
  stopAutoSave,
} from "./bufferPersistence";
export type { PersistedBuffer } from "./bufferPersistence";
