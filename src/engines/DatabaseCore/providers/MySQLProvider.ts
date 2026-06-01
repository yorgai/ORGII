/**
 * MySQL Database Provider
 *
 * Implements IDatabaseService for direct MySQL/MariaDB connections.
 * Delegates to Tauri backend commands (sqlx) for TCP connection handling.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  MySQLConnectionConfig,
  QueryOptions,
  QueryResult,
  TableInfo,
} from "../types";

interface TauriQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

interface TauriExecuteResult {
  rows_affected: number;
}

interface TauriTableInfo {
  name: string;
  table_type: string;
  row_count: number | null;
}

interface TauriColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
  default_value: string | null;
  auto_increment: boolean;
}

function buildConnectionString(config: MySQLConnectionConfig): string {
  const userPart = config.password
    ? `${config.user}:${config.password}`
    : config.user;
  const sslMode = config.ssl ? "REQUIRED" : "PREFERRED";
  return `mysql://${userPart}@${config.host}:${config.port}/${config.database}?ssl-mode=${sslMode}`;
}

export class MySQLProvider implements IDatabaseService {
  readonly type = "mysql" as const;
  readonly config: MySQLConnectionConfig;

  private _status: ConnectionStatus = { state: "disconnected" };
  private _connected = false;

  constructor(config: MySQLConnectionConfig) {
    this.config = config;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    this._status = { state: "connecting" };

    try {
      await invoke("db_sql_connect", {
        connectionId: this.config.id,
        dbType: "mysql",
        connectionString: buildConnectionString(this.config),
      });
      this._connected = true;
      this._status = { state: "connected", connectedAt: Date.now() };
    } catch (error) {
      this._connected = false;
      const message = error instanceof Error ? error.message : String(error);
      this._status = { state: "error", error: message };
      throw new Error(message);
    }
  }

  async disconnect(): Promise<void> {
    if (this._connected) {
      try {
        await invoke("db_sql_disconnect", {
          connectionId: this.config.id,
        });
      } catch {
        // Best-effort disconnect
      }
    }
    this._connected = false;
    this._status = { state: "disconnected" };
  }

  isConnected(): boolean {
    return this._connected && this._status.state === "connected";
  }

  async getTables(): Promise<TableInfo[]> {
    this.ensureConnected();

    const result = await invoke<TauriTableInfo[]>("db_sql_get_tables", {
      connectionId: this.config.id,
    });

    return result.map((table) => ({
      name: table.name,
      type:
        table.table_type === "VIEW" ? ("view" as const) : ("table" as const),
      rowCount: table.row_count ?? undefined,
    }));
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const result = await invoke<TauriColumnInfo[]>("db_sql_get_table_schema", {
      connectionId: this.config.id,
      tableName,
    });

    return result.map((col) => ({
      name: col.name,
      type: col.data_type,
      nullable: col.nullable,
      primaryKey: col.primary_key,
      defaultValue: col.default_value,
      autoIncrement: col.auto_increment,
    }));
  }

  async getTableData(
    tableName: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    this.ensureConnected();

    const {
      page = 1,
      pageSize = 100,
      orderBy,
      orderDirection = "asc",
    } = options;
    const offset = (page - 1) * pageSize;
    const startTime = performance.now();

    let sql = `SELECT * FROM \`${tableName}\``;
    if (orderBy) {
      sql += ` ORDER BY \`${orderBy}\` ${orderDirection.toUpperCase()}`;
    }
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const result = await invoke<TauriQueryResult>("db_sql_query", {
      connectionId: this.config.id,
      sql,
    });
    const duration = performance.now() - startTime;

    let totalCount: number | undefined;
    try {
      const countResult = await invoke<TauriQueryResult>("db_sql_query", {
        connectionId: this.config.id,
        sql: `SELECT COUNT(*) as count FROM \`${tableName}\``,
      });
      if (countResult.rows.length > 0) {
        totalCount = Number(countResult.rows[0][0]);
      }
    } catch {
      // Ignore count errors
    }

    return {
      columns: result.columns,
      values: result.rows,
      rowCount: result.row_count,
      totalCount,
      duration,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = performance.now();
    const result = await invoke<TauriQueryResult>("db_sql_query", {
      connectionId: this.config.id,
      sql,
    });
    const duration = performance.now() - startTime;

    return {
      columns: result.columns,
      values: result.rows,
      rowCount: result.row_count,
      duration,
    };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();

    const startTime = performance.now();
    try {
      const result = await invoke<TauriExecuteResult>("db_sql_execute", {
        connectionId: this.config.id,
        sql,
      });
      return {
        success: true,
        rowsAffected: result.rows_affected,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async insert(
    tableName: string,
    data: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const columns = Object.keys(data);
    const values = columns.map((col) => formatMySqlValue(data[col]));

    const sql = `
      INSERT INTO \`${tableName}\` (${columns.map((col) => `\`${col}\``).join(", ")})
      VALUES (${values.join(", ")})
    `;

    try {
      const result = await invoke<TauriExecuteResult>("db_sql_execute", {
        connectionId: this.config.id,
        sql,
      });
      return {
        success: true,
        rowsAffected: result.rows_affected,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async update(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const setClause = Object.entries(data)
      .map(([col, val]) => `\`${col}\` = ${formatMySqlValue(val)}`)
      .join(", ");
    const whereClause = Object.entries(where)
      .map(([col, val]) => `\`${col}\` = ${formatMySqlValue(val)}`)
      .join(" AND ");

    const sql = `UPDATE \`${tableName}\` SET ${setClause} WHERE ${whereClause}`;

    try {
      const result = await invoke<TauriExecuteResult>("db_sql_execute", {
        connectionId: this.config.id,
        sql,
      });
      return {
        success: true,
        rowsAffected: result.rows_affected,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async delete(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const whereClause = Object.entries(where)
      .map(([col, val]) => `\`${col}\` = ${formatMySqlValue(val)}`)
      .join(" AND ");

    const sql = `DELETE FROM \`${tableName}\` WHERE ${whereClause}`;

    try {
      const result = await invoke<TauriExecuteResult>("db_sql_execute", {
        connectionId: this.config.id,
        sql,
      });
      return {
        success: true,
        rowsAffected: result.rows_affected,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async save(): Promise<void> {
    // No-op for remote databases
  }

  private ensureConnected(): void {
    if (!this._connected) {
      throw new Error("Database not connected. Call connect() first.");
    }
  }
}

function formatMySqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

export default MySQLProvider;
