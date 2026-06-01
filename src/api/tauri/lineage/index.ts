/**
 * Lineage API
 *
 * Chat Session Impact Graph — queries AI session provenance and commit lineage
 * from the Rust backend.
 * Delegates to tauri/rpc for type-safe Zod-validated IPC.
 */
import { rpc } from "@src/api/tauri/rpc";
import type {
  FunctionEntry,
  SessionImpact,
} from "@src/api/tauri/rpc/schemas/lineage";

// Re-export types for backward compat
export type { FunctionEntry, SessionImpact };

export async function getProvenanceSessionIds(): Promise<string[]> {
  return rpc.lineage.getProvenanceSessionIds();
}

export async function getSessionImpact(
  sessionId: string
): Promise<SessionImpact> {
  return rpc.lineage.getSessionImpact({ sessionId });
}
