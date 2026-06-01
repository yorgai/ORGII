/**
 * Lineage RPC Schemas
 *
 * Zod schemas for get_session_impact / get_provenance_session_ids commands.
 * Rust source: src-tauri/src/project_management/lineage/
 *
 * Note: get_session_impact returns serde_json::Value in Rust, but we
 * describe the known SessionImpact shape from analytics.rs.
 */
import { z } from "zod/v4";

// ── Input schemas ──

export const GetSessionImpactInput = z.object({
  sessionId: z.string(),
});

// ── Output schemas ──

export const FunctionEntrySchema = z.object({
  file: z.string(),
  name: z.string(),
  nodeType: z.string(),
  lines: z.tuple([z.number().int(), z.number().int()]),
});

export const SessionImpactSchema = z.object({
  sessionId: z.string(),
  filesTouched: z.array(z.string()),
  functionsCreated: z.array(FunctionEntrySchema),
  commitsInfluenced: z.array(z.string()),
  totalLinesAttributed: z.number().int(),
  firstEditAt: z.number().int().nullable().optional(),
  lastCommitAt: z.number().int().nullable().optional(),
});

export type FunctionEntry = z.output<typeof FunctionEntrySchema>;
export type SessionImpact = z.output<typeof SessionImpactSchema>;
