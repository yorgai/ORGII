// Stage-1 shadow-read parity capture for the ORGII Brick adapter.
//
// Compares a Brick `history sessions` page against ORGII's existing reader
// rows WITHOUT serving Brick to the UI. Produces compact parity metrics that a
// background job can record. Per the adapter contract, a mismatch is reported,
// not fatal: callers keep serving the old reader during stages 1-3.
import {
  BrickHistoryClient,
  type BrickHistorySession,
} from "./brickHistoryClient";

/** Minimal shape of an ORGII reader row needed for parity comparison. */
export interface OrgiiSessionRowForParity {
  externalSessionId: string;
  title: string | null;
  totalTokens: number | null;
}

export interface ParityMismatch {
  externalSessionId: string;
  field: "missing_in_brick" | "missing_in_orgii" | "title" | "tokens";
  brickValue: string | number | null;
  orgiiValue: string | number | null;
}

export interface ShadowReadParityReport {
  sourceId: string;
  brickSessionCount: number;
  orgiiSessionCount: number;
  matchedCount: number;
  mismatches: ParityMismatch[];
  ok: boolean;
}

function brickTotalTokens(session: BrickHistorySession): number | null {
  if (session.inputTokens === null && session.outputTokens === null) {
    return null;
  }
  return (session.inputTokens ?? 0) + (session.outputTokens ?? 0);
}

function normalizeTitle(title: string | null): string | null {
  if (title === null) return null;
  const trimmed = title.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Compares Brick and ORGII rows keyed by externalSessionId. Tolerances follow
 * the contract: titles compared normalized; tokens compared only when both
 * sides expose them.
 */
export function compareSessionParity(
  sourceId: string,
  brickSessions: BrickHistorySession[],
  orgiiSessions: OrgiiSessionRowForParity[]
): ShadowReadParityReport {
  const brickById = new Map(brickSessions.map((s) => [s.externalSessionId, s]));
  const orgiiById = new Map(orgiiSessions.map((s) => [s.externalSessionId, s]));
  const mismatches: ParityMismatch[] = [];
  let matchedCount = 0;

  for (const orgii of orgiiSessions) {
    const brick = brickById.get(orgii.externalSessionId);
    if (!brick) {
      mismatches.push({
        externalSessionId: orgii.externalSessionId,
        field: "missing_in_brick",
        brickValue: null,
        orgiiValue: orgii.title,
      });
      continue;
    }
    let rowMatched = true;
    const brickTitle = normalizeTitle(brick.title);
    const orgiiTitle = normalizeTitle(orgii.title);
    if (
      brickTitle !== null &&
      orgiiTitle !== null &&
      brickTitle !== orgiiTitle
    ) {
      mismatches.push({
        externalSessionId: orgii.externalSessionId,
        field: "title",
        brickValue: brickTitle,
        orgiiValue: orgiiTitle,
      });
      rowMatched = false;
    }
    const brickTokens = brickTotalTokens(brick);
    if (
      brickTokens !== null &&
      orgii.totalTokens !== null &&
      brickTokens !== orgii.totalTokens
    ) {
      mismatches.push({
        externalSessionId: orgii.externalSessionId,
        field: "tokens",
        brickValue: brickTokens,
        orgiiValue: orgii.totalTokens,
      });
      rowMatched = false;
    }
    if (rowMatched) matchedCount += 1;
  }

  for (const brick of brickSessions) {
    if (!orgiiById.has(brick.externalSessionId)) {
      mismatches.push({
        externalSessionId: brick.externalSessionId,
        field: "missing_in_orgii",
        brickValue: brick.title,
        orgiiValue: null,
      });
    }
  }

  return {
    sourceId,
    brickSessionCount: brickSessions.length,
    orgiiSessionCount: orgiiSessions.length,
    matchedCount,
    mismatches,
    ok: mismatches.length === 0,
  };
}

/**
 * Runs a single shadow-read parity pass for one source. Returns null when Brick
 * is unavailable or incompatible (caller keeps serving the old reader).
 */
export async function runShadowReadParity(
  client: BrickHistoryClient,
  sourceId: string,
  orgiiSessions: OrgiiSessionRowForParity[],
  options: { limit?: number; offset?: number } = {}
): Promise<ShadowReadParityReport | null> {
  if (!(await client.isCompatible())) {
    return null;
  }
  try {
    const page = await client.sessions(sourceId, options);
    return compareSessionParity(sourceId, page.sessions, orgiiSessions);
  } catch {
    return null;
  }
}
