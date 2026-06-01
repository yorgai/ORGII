/**
 * Rust Ingestion Bridge
 *
 * TypeScript wrappers for the Rust-side event ingestion pipeline.
 * Replaces the TS-side normalizeChunks + consolidateActivityChunks +
 * mergeToolCallChunks pipeline with Rust Tauri commands.
 *
 * Two entry points:
 * - processChunksRust: Full pipeline (consolidate → normalize → merge) without EventStore storage
 * - normalizeChunkRust: Single chunk normalization (for streaming completions)
 */
import { rpc } from "@src/api/tauri/rpc";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { ActivityChunk } from "@src/types/session/session";

// ============================================
// Types (mirror Rust IngestionResult)
// ============================================

interface RawActivityChunk {
  chunk_id?: string | null;
  session_id?: string | null;
  action_type?: string | null;
  function?: string | null;
  args?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  created_at?: string | null;
  thread_id?: string | null;
  process_id?: string | null;
  call_id?: string | null;
}

// ============================================
// Conversion Helpers
// ============================================

function toRawChunk(chunk: ActivityChunk): RawActivityChunk {
  return {
    chunk_id: chunk.chunk_id,
    session_id: chunk.session_id ?? null,
    action_type: chunk.action_type,
    function: chunk.function,
    args: chunk.args,
    result: chunk.result,
    created_at: chunk.created_at,
    thread_id: chunk.thread_id ?? null,
    process_id: chunk.process_id ?? null,
    call_id: null,
  };
}

// ============================================
// Public API
// ============================================

/**
 * Process raw activity chunks through the full Rust pipeline:
 * consolidate → normalize → merge tool calls.
 *
 * Does NOT store in the Rust EventStore — caller manages its own storage
 * (Jotai atoms, IndexedDB, EventStoreProxy, etc.).
 */
export async function processChunksRust(
  chunks: ActivityChunk[],
  sessionId: string
): Promise<SessionEvent[]> {
  const rawChunks = chunks.map(toRawChunk);
  const result = await rpc.sessionCore.eventStore.processChunks({
    sessionId,
    chunks: rawChunks,
  });
  return result.events;
}

/**
 * Normalize a single chunk via Rust without consolidation.
 * Used for streaming completion events and single-event normalization.
 */
export async function normalizeChunkRust(
  chunk: ActivityChunk,
  sessionId: string
): Promise<SessionEvent> {
  const rawChunk = toRawChunk(chunk);
  return rpc.sessionCore.eventStore.normalizeChunk({
    sessionId,
    chunk: rawChunk,
  });
}

/**
 * Set the active repository context on the Rust EventStore.
 * All subsequent events that don't already carry repo info will
 * be auto-stamped with these values.
 */
export async function setEventStoreRepoContext(
  repoId: string | undefined,
  repoPath: string | undefined
): Promise<void> {
  await rpc.sessionCore.eventStore.setRepoContext({
    repoId: repoId ?? null,
    repoPath: repoPath ?? null,
  });
}
