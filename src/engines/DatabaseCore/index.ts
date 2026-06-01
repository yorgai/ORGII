/**
 * DatabaseCore Engine
 *
 * Self-contained database subsystem providing a unified interface for all
 * database providers (SQLite, PostgreSQL, MySQL, Supabase, Neon, Turso). Consumed by:
 * - WorkStation DatabaseManager (UI)
 * - Integrations (credential management, connection registry)
 * - Agent tools (db_query, db_schema, etc.)
 */

export { DatabaseServiceFactory } from "./factory";
export type { ConfigLoader } from "./factory";

export { isValidSqliteFile } from "./providers/isValidSqliteFile";

export type {
  DatabaseType,
  ConnectionStatus,
  TableInfo,
  ColumnInfo,
  QueryOptions,
  QueryResult,
  ExecuteResult,
  DatabaseConnectionConfig,
  SqliteConnectionConfig,
  SupabaseConnectionConfig,
  TursoConnectionConfig,
  NeonConnectionConfig,
  PostgresConnectionConfig,
  MySQLConnectionConfig,
  IDatabaseService,
} from "./types";

export {
  DATABASE_TYPES,
  isSqliteConfig,
  isSupabaseConfig,
  isTursoConfig,
  isNeonConfig,
  isPostgresConfig,
  isMySQLConfig,
  getConnectionPath,
} from "./types";
