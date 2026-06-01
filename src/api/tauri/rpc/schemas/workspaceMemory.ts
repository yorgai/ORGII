/**
 * Workspace Memory (L2) RPC Schemas
 *
 * Zod schemas for L2 workspace memory Tauri commands.
 * Rust source: src-tauri/src/agent_core/intelligence/memory/commands.rs
 */
import { z } from "zod/v4";

// ── Input schemas ──

export const ListInput = z.object({
  workspace: z.string(),
});

export const ReadInput = z.object({
  workspace: z.string(),
  filename: z.string(),
});

export const StatusInput = z.object({
  workspace: z.string(),
});

export const IndexInput = z.object({
  workspace: z.string(),
});

export const WriteInput = z.object({
  workspace: z.string(),
  filename: z.string(),
  content: z.string(),
});

export const DeleteInput = z.object({
  workspace: z.string(),
  filename: z.string(),
});

export const ClearInput = z.object({
  workspace: z.string(),
});

// ── Output schemas ──

export const EntrySchema = z.object({
  filename: z.string(),
  description: z.string().nullable(),
  memoryType: z.string().nullable(),
  mtimeMs: z.number(),
  ageDisplay: z.string(),
});

export type WorkspaceMemoryEntry = z.output<typeof EntrySchema>;

export const DetailSchema = z.object({
  filename: z.string(),
  description: z.string().nullable(),
  memoryType: z.string().nullable(),
  mtimeMs: z.number(),
  ageDisplay: z.string(),
  freshnessCaveat: z.string(),
  content: z.string(),
});

export type WorkspaceMemoryDetail = z.output<typeof DetailSchema>;

export const StatusSchema = z.object({
  memoryCount: z.number(),
  lastConsolidatedAt: z.number(),
  hoursSinceConsolidation: z.number(),
  sessionsSinceConsolidation: z.number(),
  lockHeld: z.boolean(),
  memoryDir: z.string(),
});

export type WorkspaceMemoryStatus = z.output<typeof StatusSchema>;
