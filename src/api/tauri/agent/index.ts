/**
 * Agent API
 *
 * Tauri IPC commands for agent management, grouped by concern.
 *
 * - session:    Session lifecycle, persistence, interactions, message processing
 * - gateway:    Local gateway process start/stop/status
 * - config:     Per-agent configuration read/write
 * - tools:      tool registry, channel control
 * - automation: Desktop permissions, automation rules, webhooks
 */

export * from "./types";
export * from "./toolNames";
export * from "./session";
export * from "./sessionWorkspace";
export * from "./gateway";
export * from "./config";
export * from "./tools";
export * from "./automation";
export * from "./orgTasks";
