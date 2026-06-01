/**
 * Turso/LibSQL Database Provider
 *
 * Implements IDatabaseService for Turso edge databases and local LibSQL.
 * Uses the @libsql/client for SQLite-compatible operations over HTTP.
 */
import { Client, type InValue, createClient } from "@libsql/client";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  QueryOptions,
  QueryResult,
  TableInfo,
  TursoConnectionConfig,
} from "../types";

function toInValues(values: unknown[]): InValue[] {
  return values.map((v) => (v === undefined ? null : (v as InValue)));
}

export class TursoProvider implements IDatabaseService {
  readonly type = "turso" as const;
  readonly config: TursoConnectionConfig;

  private _status: ConnectionStatus = { state: "disconnected" };
  private client: Client | null = null;

  constructor(config: TursoConnectionConfig) {
    this.config = config;
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    this._status = { state: "connecting" };

    try {
      this.client = createClient({
        url: this.config.url,
        authToken: this.config.authToken,
      });
      await this.client.execute("SELECT 1");
      this._status = { state: "connected", connectedAt: Date.now() };
    } catch (error) {
      this.client = null;
      const message =
        error instanceof Error ? error.message : "Failed to connect";
      this._status = { state: "error", error: message };
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
    this._status = { state: "disconnected" };
  }

  isConnected(): boolean {
    return this.client !== null && this._status.state === "connected";
  }

  async getTables(): Promise<TableInfo[]> {
    this.ensureConnected();

    const result = await this.client!.execute(`
      SELECT name, type FROM sqlite_master 
      WHERE type IN ('table', 'view') 
      AND name NOT LIKE 'sqlite_%'
      AND name NOT LIKE '_litestream_%'
      AND name NOT LIKE 'libsql_%'
      ORDER BY name
    `);

    const tables: TableInfo[] = result.rows.map((row) => ({
      name: String(row.name),
      type: row.type === "view" ? "view" : "table",
    }));

    for (const table of tables) {
      if (table.type === "table") {
        try {
          const countResult = await this.client!.execute(
            `SELECT COUNT(*) as count FROM "${table.name}"`
          );
          if (countResult.rows.length > 0) {
            table.rowCount = Number(countResult.rows[0].count);
          }
        } catch {
          // Ignore count errors
        }
      }
    }

    return tables;
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const result = await this.client!.execute(
      `PRAGMA table_info("${tableName}")`
    );

    const createResult = await this.client!.execute(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name="${tableName}"`
    );
    const createSql =
      createResult.rows.length > 0
        ? String(createResult.rows[0].sql ?? "").toUpperCase()
        : "";

    return result.rows.map((row) => {
      const columnName = String(row.name);
      const isPk = Boolean(row.pk);

      const isAutoIncrement =
        isPk &&
        (createSql.includes("AUTOINCREMENT") ||
          createSql.includes(
            `"${columnName.toUpperCase()}" INTEGER PRIMARY KEY`
          ) ||
          createSql.includes(
            `${columnName.toUpperCase()} INTEGER PRIMARY KEY`
          ));

      return {
        name: columnName,
        type: String(row.type),
        nullable: !row.notnull,
        primaryKey: isPk,
        defaultValue: row.dflt_value as string | null,
        autoIncrement: isAutoIncrement,
      };
    });
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

    let sql = `SELECT * FROM "${tableName}"`;
    if (orderBy) {
      sql += ` ORDER BY "${orderBy}" ${orderDirection.toUpperCase()}`;
    }
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const startTime = performance.now();
    const result = await this.client!.execute(sql);
    const duration = performance.now() - startTime;

    const countResult = await this.client!.execute(
      `SELECT COUNT(*) as count FROM "${tableName}"`
    );
    const totalCount =
      countResult.rows.length > 0 ? Number(countResult.rows[0].count) : 0;

    if (result.rows.length === 0) {
      return {
        columns: result.columns,
        values: [],
        rowCount: 0,
        totalCount,
        duration,
      };
    }

    const columns = result.columns;
    const values = result.rows.map((row) =>
      columns.map((col) => row[col] as unknown)
    );

    return {
      columns,
      values,
      rowCount: result.rows.length,
      totalCount,
      duration,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = performance.now();
    const result = await this.client!.execute(sql);
    const duration = performance.now() - startTime;

    if (result.rows.length === 0) {
      return { columns: result.columns, values: [], rowCount: 0, duration };
    }

    const columns = result.columns;
    const values = result.rows.map((row) =>
      columns.map((col) => row[col] as unknown)
    );

    return { columns, values, rowCount: result.rows.length, duration };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();

    const startTime = performance.now();

    try {
      const result = await this.client!.execute(sql);
      const duration = performance.now() - startTime;
      return {
        success: true,
        rowsAffected: result.rowsAffected,
        duration,
        lastInsertId: result.lastInsertRowid
          ? Number(result.lastInsertRowid)
          : undefined,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message =
        error instanceof Error ? error.message : "Execution failed";
      return { success: false, rowsAffected: 0, duration, error: message };
    }
  }

  async insert(
    tableName: string,
    data: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();

    const columns = Object.keys(data);
    const placeholders = columns.map(() => "?").join(", ");
    const values = Object.values(data);

    const sql = `INSERT INTO "${tableName}" (${columns.map((col) => `"${col}"`).join(", ")}) VALUES (${placeholders})`;
    const startTime = performance.now();

    try {
      const result = await this.client!.execute({
        sql,
        args: toInValues(values),
      });
      const duration = performance.now() - startTime;
      return {
        success: true,
        rowsAffected: result.rowsAffected,
        duration,
        lastInsertId: result.lastInsertRowid
          ? Number(result.lastInsertRowid)
          : undefined,
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : "Insert failed";
      return { success: false, rowsAffected: 0, duration, error: message };
    }
  }

  async update(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();

    const setClauses = Object.keys(data)
      .map((col) => `"${col}" = ?`)
      .join(", ");
    const whereClauses = Object.keys(where)
      .map((col) => `"${col}" = ?`)
      .join(" AND ");

    const sql = `UPDATE "${tableName}" SET ${setClauses} WHERE ${whereClauses}`;
    const values = [...Object.values(data), ...Object.values(where)];
    const startTime = performance.now();

    try {
      const result = await this.client!.execute({
        sql,
        args: toInValues(values),
      });
      const duration = performance.now() - startTime;
      return { success: true, rowsAffected: result.rowsAffected, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : "Update failed";
      return { success: false, rowsAffected: 0, duration, error: message };
    }
  }

  async delete(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();

    const whereClauses = Object.keys(where)
      .map((col) => `"${col}" = ?`)
      .join(" AND ");

    const sql = `DELETE FROM "${tableName}" WHERE ${whereClauses}`;
    const startTime = performance.now();

    try {
      const result = await this.client!.execute({
        sql,
        args: toInValues(Object.values(where)),
      });
      const duration = performance.now() - startTime;
      return { success: true, rowsAffected: result.rowsAffected, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      const message = error instanceof Error ? error.message : "Delete failed";
      return { success: false, rowsAffected: 0, duration, error: message };
    }
  }

  async save(): Promise<void> {
    // No-op for remote databases
  }

  private ensureConnected(): void {
    if (!this.client) {
      throw new Error("Database not connected. Call connect() first.");
    }
  }
}

export default TursoProvider;
