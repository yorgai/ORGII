/**
 * Session Replay Types
 *
 * Shared types for session replay across different simulator apps
 * (DatabaseManager, ProjectManager, etc.)
 */
import type { AppSubtool } from "@src/engines/SessionCore/rendering/registry/types";

import type { SimulatorAppBaseState } from "./types";

// ============================================
// Base Operation Types
// ============================================

/**
 * Base operation type for session replay.
 * Extended by specific apps (DatabaseOperation, ProjectOperation).
 */
export interface BaseOperation {
  /** Unique identifier (usually event_id) */
  eventId: string;
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Operation type (app-specific or AppSubtool) */
  type: string | AppSubtool;
  /** Summary of the result for display */
  resultSummary: string;
  /** Whether this operation resulted in an error */
  isError: boolean;
  /** Whether this is the current operation in replay */
  isCurrent: boolean;
}

/**
 * Database operation for session replay.
 */
export interface DatabaseOperation extends BaseOperation {
  type: "database" | AppSubtool;
  /** Database connection identifier */
  connectionId?: string;
  /** Display name of the connection */
  connectionName?: string;
  /** SQL query executed */
  sql?: string;
  /** Target table name */
  table?: string;
  /** Execution duration in milliseconds */
  duration?: number;
}

/**
 * Project operation for session replay.
 */
export interface ProjectOperation extends BaseOperation {
  type: "project" | AppSubtool;
  functionName: string;
  /** Action performed */
  action?: string;
  /** Tool args captured from the event */
  args: Record<string, unknown>;
  /** Text output captured from the tool result */
  resultText: string;
  /** Project name */
  projectName?: string;
  /** Work item title */
  workItemTitle?: string;
}

// ============================================
// Simulator State Types
// ============================================

/**
 * Simulator state for DatabaseManager.
 */
export interface SimulatorDatabaseState extends SimulatorAppBaseState {
  operations: DatabaseOperation[];
  selectedOperation: DatabaseOperation | null;
  connectionSummary: Map<string, { name: string; queryCount: number }>;
}

/**
 * Simulator state for ProjectManager.
 */
export interface SimulatorProjectState extends SimulatorAppBaseState {
  operations: ProjectOperation[];
  selectedOperation: ProjectOperation | null;
}
