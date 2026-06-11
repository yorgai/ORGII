/**
 * SimulatorIDE Deduplication
 *
 * Functions for consolidating and deduplicating operation entries
 * (file, shell, explore) to produce clean lists for display.
 */
import type {
  ExploreOperationEntry,
  FileOperationEntry,
  ShellOperationEntry,
} from "./types";

// ============================================
// Payload stripping (memory)
// ============================================

/**
 * Drops large string payloads while keeping `event` for lazy rehydration via
 * `resolveFileOperationPayload`. Preserves `writeHasBaselineContent` and metadata.
 */
function stripFileOperationPayload(op: FileOperationEntry): FileOperationEntry {
  return {
    ...op,
    content: undefined,
    contentStartLine: undefined,
    oldContent: undefined,
    newContent: undefined,
    diff: undefined,
  };
}

// ============================================
// File Operation Deduplication
// ============================================

/**
 * Consolidate file operations for display.
 *
 * Groups operations by file path and type (read/write), combining stats.
 * Shows one entry per file+type with:
 * - Combined line counts (for writes)
 * - All operations stored for combined diff rendering
 * - isCurrent = true if ANY operation in group is current
 * - relatedEventIds for navigation lookup
 *
 * NOTE: We do NOT dedupe by content anymore - the same content change can
 * legitimately happen at different line positions in a file (e.g., fixing
 * the same pattern in multiple places). Start/end event deduplication is
 * handled at the source level in eventGrouping.ts.
 *
 * This gives clean UI while preserving all event IDs and content for replay.
 */
export function dedupeFileOperations(
  fileOps: FileOperationEntry[]
): FileOperationEntry[] {
  // Group by filePath + type
  const groups = new Map<string, FileOperationEntry[]>();

  for (const op of fileOps) {
    const key = `${op.filePath}:${op.type}`;
    const existing = groups.get(key) || [];
    existing.push(op);
    groups.set(key, existing);
  }

  // Consolidate each group
  const result: FileOperationEntry[] = [];

  for (const [_key, ops] of groups) {
    if (ops.length === 1) {
      // Single operation - no consolidation needed
      result.push(stripFileOperationPayload(ops[0]));
    } else {
      // Multiple operations on same file - consolidate
      const latestOp = ops[ops.length - 1]; // Use latest for base info

      // Prefer operation with content (latest op might be a "running" event without content)
      const opWithContent = [...ops]
        .reverse()
        .find((op) => op.content || op.oldContent || op.newContent || op.diff);
      const baseOp = opWithContent || latestOp;

      // Sum up line changes for writes
      let totalLinesAdded = 0;
      let totalLinesRemoved = 0;
      for (const op of ops) {
        totalLinesAdded += op.linesAdded || 0;
        totalLinesRemoved += op.linesRemoved || 0;
      }

      // Find the current operation (if any) to use its eventId
      const currentOp = ops.find((op) => op.isCurrent);
      const anyCurrent = ops.some((op) => op.isCurrent);

      // Dedupe ops with identical diff content — same oldContent+newContent
      // produced by the agent writing the same change twice. Keep the last
      // occurrence so isCurrent / eventId of the most recent survives.
      const seenDiffKeys = new Set<string>();
      const uniqueOps: FileOperationEntry[] = [];
      for (let opIdx = ops.length - 1; opIdx >= 0; opIdx--) {
        const diffOp = ops[opIdx];
        const diffKey = `${diffOp.oldContent ?? ""}|${diffOp.newContent ?? ""}|${diffOp.diff ?? ""}|${diffOp.newStartLine ?? ""}`;
        if (!seenDiffKeys.has(diffKey)) {
          seenDiffKeys.add(diffKey);
          uniqueOps.unshift(diffOp);
        }
      }

      // Create consolidated entry with ALL operations stored
      // Use baseOp (which has content) spread first, then override with latestOp metadata
      const consolidated: FileOperationEntry = {
        ...baseOp,
        eventId: currentOp?.eventId || latestOp.eventId,
        isCurrent: anyCurrent,
        linesAdded: totalLinesAdded || undefined,
        linesRemoved: totalLinesRemoved || undefined,
        // Store all related event IDs for lookup
        relatedEventIds: ops.map((op) => op.eventId),
        editCount: uniqueOps.length,
        // Store deduplicated operations for combined diff rendering (payloads stripped below)
        relatedOperations: uniqueOps.map(stripFileOperationPayload),
      };

      result.push(stripFileOperationPayload(consolidated));
    }
  }

  return result;
}

// ============================================
// Shell Operation Deduplication
// ============================================

/**
 * Generate a content-based key for shell operation deduplication.
 * Two shell operations with the same command are considered potential duplicates.
 */
function getShellCallId(op: ShellOperationEntry): string {
  const args = op.event.args as Record<string, unknown> | undefined;
  const result = op.event.result as Record<string, unknown> | undefined;

  if (op.event.callId) return op.event.callId;
  if (typeof args?.call_id === "string") return args.call_id;
  if (typeof result?.call_id === "string") return result.call_id;
  return "";
}

function getShellContentKey(op: ShellOperationEntry): string {
  const callId = getShellCallId(op);
  if (callId) return `call:${callId}`;
  return op.command ? `command:${op.command}` : "";
}

/**
 * Deduplicate shell operations with identical commands.
 * Groups by command and keeps the one with output (completed) over the one without (running).
 */
export function dedupeShellOperations(
  shellOps: ShellOperationEntry[]
): ShellOperationEntry[] {
  // Group by command
  const groups = new Map<string, ShellOperationEntry[]>();

  for (const op of shellOps) {
    const key = getShellContentKey(op);
    if (!key) {
      // Keep ops without command as-is (shouldn't happen normally)
      groups.set(op.eventId, [op]);
      continue;
    }

    const existing = groups.get(key) || [];
    existing.push(op);
    groups.set(key, existing);
  }

  // For each group, keep the best one (prefer with output, or current)
  const result: ShellOperationEntry[] = [];

  for (const [_key, ops] of groups) {
    if (ops.length === 1) {
      result.push(ops[0]);
    } else {
      // Find the best one: prefer completed (has output) over running (no output)
      // Also prefer isCurrent
      const currentOp = ops.find((op) => op.isCurrent);
      const completedOp = ops.find(
        (op) => op.output !== undefined || op.exitCode !== undefined
      );
      const bestOp = currentOp || completedOp || ops[ops.length - 1];
      result.push(bestOp);
    }
  }

  return result;
}

// ============================================
// Explore Operation Deduplication
// ============================================

/**
 * Deduplicate explore operations with identical queries.
 * Groups by query and keeps the one with results (completed) over the one without (running).
 */
export function dedupeExploreOperations(
  exploreOps: ExploreOperationEntry[]
): ExploreOperationEntry[] {
  // Group by query + exploreType. Empty LSP/read_lints checks are intentionally
  // distinct because multiple checked-file batches can have no diagnostic text.
  // Empty generic searches are lifecycle/fallback duplicates and should collapse.
  const groups = new Map<string, ExploreOperationEntry[]>();

  for (const op of exploreOps) {
    const query = op.query.trim();
    const key = query
      ? `${op.exploreType}:${query}`
      : op.exploreType === "query_lsp"
        ? op.eventId
        : `${op.exploreType}:empty:${op.event.functionName || ""}:${op.directory || ""}`;

    const existing = groups.get(key) || [];
    existing.push(op);
    groups.set(key, existing);
  }

  // For each group, keep the best one (prefer completed data over empty current shells)
  const result: ExploreOperationEntry[] = [];
  const hasExploreData = (op: ExploreOperationEntry) =>
    op.results.length > 0 ||
    (op.files && op.files.length > 0) ||
    op.totalMatches > 0;

  for (const [_key, ops] of groups) {
    if (ops.length === 1) {
      result.push(ops[0]);
    } else {
      const currentOpWithData = ops.find(
        (op) => op.isCurrent && hasExploreData(op)
      );
      const completedOp = ops.find((op) => !op.isLoading && hasExploreData(op));
      const bestOp =
        currentOpWithData ||
        completedOp ||
        ops.find((op) => op.isCurrent) ||
        ops[ops.length - 1];
      result.push(bestOp);
    }
  }

  return result;
}
