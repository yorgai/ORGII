import { defineProcedure } from "../invoke";
import * as schemas from "../schemas";

export const sessionAggregate = {
  list: defineProcedure("session_aggregate_list")
    .input(schemas.sessionAggregate.SessionAggregateListInput)
    .output(schemas.sessionAggregate.SessionListResponseSchema)
    .build(),

  getStats: defineProcedure("session_get_aggregate_stats")
    .input(schemas.sessionAggregate.SessionGetAggregateStatsInput)
    .output(schemas.sessionAggregate.AggregateStatsSchema)
    .build(),

  /**
   * Patch in-session mutable fields for a single session row.
   *
   * - `model` + optional `accountId` (atomic pair)
   * - `agentExecMode` (Rust-agent and CLI-agent sessions)
   *
   * The Rust handler rejects half-applied combinations (`accountId`
   * without `model`), so frontend callers can rely on either a clean
   * success or a descriptive error string.
   */
  patch: defineProcedure("session_patch")
    .input(schemas.sessionAggregate.SessionPatchInput)
    .build(),
} as const;
