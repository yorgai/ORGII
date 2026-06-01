import type { DatabaseType } from "@src/engines/DatabaseCore";

export type DatabaseConnectionStatus =
  | "connected"
  | "connecting"
  | "error"
  | "disabled"
  | "unknown";

export interface DatabaseIntegrationEntry {
  id: string;
  name: string;
  type: DatabaseType;
  connectionStatus: DatabaseConnectionStatus;
  connectionError?: string;
  url: string;
}

export interface DatabaseProbeResult {
  ok: boolean;
  error?: string;
  tableCount?: number;
  elapsed_ms: number;
}
