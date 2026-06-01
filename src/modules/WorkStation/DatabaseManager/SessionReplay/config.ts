/**
 * SessionReplayDatabase Configuration
 *
 * Registry configuration for the Database simulator app.
 * Uses Rust registry (getAppTypeForTool) as single source of truth for event matching.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { getAppSubtool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import { defineSimulatorAppConfig } from "@src/engines/Simulator/apps/core/configFactory";
import { AppType } from "@src/engines/Simulator/types/appTypes";

import type { DatabaseOperation, SimulatorDatabaseState } from "./types";

function extractDatabaseOp(
  event: SessionEvent,
  isCurrent: boolean
): DatabaseOperation | null {
  // Use Rust registry to determine if this is a database event
  const appSubtool = getAppSubtool(event.functionName);
  if (appSubtool !== "database") return null;

  const params = event.args as Record<string, unknown> | undefined;
  const result = event.result as Record<string, unknown> | string | undefined;
  const isError =
    typeof result === "string"
      ? result.toLowerCase().includes("error")
      : Boolean(result && (result as Record<string, unknown>).error);

  let resultSummary = "";
  if (typeof result === "string") {
    resultSummary = result.slice(0, 200);
  } else if (result && typeof result === "object") {
    const rowCount = (result as Record<string, unknown>).rowCount;
    const tableCount = (result as Record<string, unknown>).tableCount;
    if (typeof rowCount === "number") resultSummary = `${rowCount} rows`;
    else if (typeof tableCount === "number")
      resultSummary = `${tableCount} tables`;
    else resultSummary = JSON.stringify(result).slice(0, 200);
  }

  return {
    eventId: event.id,
    timestamp: new Date(event.createdAt).getTime(),
    type: "database",
    connectionId: params?.connection_id as string | undefined,
    connectionName: params?.connection_name as string | undefined,
    sql: params?.sql as string | undefined,
    table: params?.table as string | undefined,
    resultSummary,
    isError,
    isCurrent,
    duration: undefined,
  };
}

function deriveDatabaseState(
  events: SessionEvent[],
  currentEventId: string | null
): Omit<
  SimulatorDatabaseState,
  keyof import("@src/engines/Simulator/apps/core/types").SimulatorAppBaseState
> {
  const operations: DatabaseOperation[] = [];
  const connectionSummary = new Map<
    string,
    { name: string; queryCount: number }
  >();

  for (const event of events) {
    const isCurrent = event.id === currentEventId;
    const op = extractDatabaseOp(event, isCurrent);
    if (!op) continue;

    operations.push(op);

    if (op.connectionId) {
      const existing = connectionSummary.get(op.connectionId);
      if (existing) {
        existing.queryCount++;
      } else {
        connectionSummary.set(op.connectionId, {
          name: op.connectionName ?? op.connectionId,
          queryCount: 1,
        });
      }
    }
  }

  const selectedOperation =
    operations.find((op) => op.eventId === currentEventId) ??
    operations[operations.length - 1] ??
    null;

  return { operations, selectedOperation, connectionSummary };
}

/**
 * Database simulator app config.
 * Uses Rust registry for event matching.
 */
export const DATABASE_APP_CONFIG =
  defineSimulatorAppConfig<SimulatorDatabaseState>({
    appType: AppType.DB_MANAGER,
    name: "DB Manager",
    icon: "Database",
    deriveState: deriveDatabaseState,
  });
