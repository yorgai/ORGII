/**
 * Gateway RPC Schemas
 *
 * Zod schemas for gateway_* Tauri commands.
 * Rust source: src-tauri/src/agent_core/state/commands/session/mod.rs
 */
import { z } from "zod/v4";

// ── Output schemas ──

export const GatewayStatusSchema = z.object({
  running: z.boolean(),
  activeSessions: z.number().int(),
});

export type GatewayStatus = z.output<typeof GatewayStatusSchema>;
