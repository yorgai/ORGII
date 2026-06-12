/**
 * Session Adapter Registry
 *
 * Registers all session adapters at module init.
 * Import this module to ensure adapters are available via getAdapterForSession().
 */
import { registerAdapter } from "../types";
import { cliAdapter } from "./cliAdapter";
import { AGENT_CONFIG, createRustAgentAdapter } from "./createRustAgentAdapter";
import { cursorIdeAdapter } from "./cursorIdeAdapter";
import { externalHistoryAdapter } from "./externalHistoryAdapter";
import { remoteSharedSessionAdapter } from "./remoteSharedSessionAdapter";

/** Unified agent adapter — handles all Rust-native agents (OS, SDE, custom). */
export const agentAdapter = createRustAgentAdapter(AGENT_CONFIG);

registerAdapter(agentAdapter);
registerAdapter(cliAdapter);
registerAdapter(cursorIdeAdapter);
registerAdapter(externalHistoryAdapter);
registerAdapter(remoteSharedSessionAdapter);

export {
  cliAdapter,
  cursorIdeAdapter,
  externalHistoryAdapter,
  remoteSharedSessionAdapter,
};
