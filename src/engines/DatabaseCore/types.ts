/**
 * Database Core Types
 *
 * Unified interface for all database providers
 * (SQLite, Supabase, Turso, Neon, PostgreSQL, MySQL).
 * This abstraction allows any consumer (WorkStation UI, Integrations, Agents)
 * to work with any database type uniformly.
 */

// ============================================
// Database Types
// ============================================

export const DATABASE_TYPES = [
  "sqlite",
  "supabase",
  "turso",
  "neon",
  "postgres",
  "mysql",
] as const;

export type DatabaseType = (typeof DATABASE_TYPES)[number];

export type ConnectionStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected"; connectedAt: number }
  | { state: "error"; error: string };

// ============================================
// Schema Types
// ============================================

export interface TableInfo {
  name: string;
  type: "table" | "view";
  rowCount?: number;
  sql?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  autoIncrement?: boolean;
}

// ============================================
// Query Types
// ============================================

export interface QueryOptions {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  filters?: Record<string, unknown>;
}

export interface QueryResult {
  columns: string[];
  values: unknown[][];
  rowCount: number;
  totalCount?: number;
  duration: number;
}

export interface ExecuteResult {
  success: boolean;
  rowsAffected: number;
  duration: number;
  lastInsertId?: number | string;
  error?: string;
}

// ============================================
// Connection Configuration
// ============================================

interface BaseConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  createdAt: number;
  updatedAt: number;
}

export interface SqliteConnectionConfig extends BaseConnectionConfig {
  type: "sqlite";
  filePath: string;
}

export interface SupabaseConnectionConfig extends BaseConnectionConfig {
  type: "supabase";
  url: string;
  accessToken: string;
  schema?: string;
}

export interface TursoConnectionConfig extends BaseConnectionConfig {
  type: "turso";
  url: string;
  authToken?: string;
}

export interface NeonConnectionConfig extends BaseConnectionConfig {
  type: "neon";
  connectionString: string;
}

export interface PostgresConnectionConfig extends BaseConnectionConfig {
  type: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}

export interface MySQLConnectionConfig extends BaseConnectionConfig {
  type: "mysql";
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}

export type DatabaseConnectionConfig =
  | SqliteConnectionConfig
  | SupabaseConnectionConfig
  | TursoConnectionConfig
  | NeonConnectionConfig
  | PostgresConnectionConfig
  | MySQLConnectionConfig;

// ============================================
// Service Interface
// ============================================

export interface IDatabaseService {
  readonly type: DatabaseType;
  readonly config: DatabaseConnectionConfig;
  readonly status: ConnectionStatus;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  getTables(): Promise<TableInfo[]>;
  getTableSchema(tableName: string): Promise<ColumnInfo[]>;

  getTableData(tableName: string, options?: QueryOptions): Promise<QueryResult>;
  query(sql: string): Promise<QueryResult>;
  execute(sql: string): Promise<ExecuteResult>;

  insert(
    tableName: string,
    data: Record<string, unknown>
  ): Promise<ExecuteResult>;
  update(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<ExecuteResult>;
  delete(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<ExecuteResult>;

  save?(): Promise<void>;
}

// ============================================
// Type Guards
// ============================================

export function isSqliteConfig(
  config: DatabaseConnectionConfig
): config is SqliteConnectionConfig {
  return config.type === "sqlite";
}

export function isSupabaseConfig(
  config: DatabaseConnectionConfig
): config is SupabaseConnectionConfig {
  return config.type === "supabase";
}

export function isTursoConfig(
  config: DatabaseConnectionConfig
): config is TursoConnectionConfig {
  return config.type === "turso";
}

export function isNeonConfig(
  config: DatabaseConnectionConfig
): config is NeonConnectionConfig {
  return config.type === "neon";
}

export function isPostgresConfig(
  config: DatabaseConnectionConfig
): config is PostgresConnectionConfig {
  return config.type === "postgres";
}

export function isMySQLConfig(
  config: DatabaseConnectionConfig
): config is MySQLConnectionConfig {
  return config.type === "mysql";
}

// ============================================
// Connection Path Helper
// ============================================

export function getConnectionPath(config: DatabaseConnectionConfig): string {
  switch (config.type) {
    case "sqlite":
      return config.filePath;
    case "supabase":
      return config.url;
    case "turso":
      return config.url;
    case "neon":
      return config.connectionString;
    case "postgres":
      return `${config.host}:${config.port}/${config.database}`;
    case "mysql":
      return `${config.host}:${config.port}/${config.database}`;
    default:
      return "";
  }
}
