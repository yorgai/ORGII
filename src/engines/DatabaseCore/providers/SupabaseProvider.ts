/**
 * Supabase Database Provider
 *
 * Implements IDatabaseService for Supabase/PostgreSQL databases.
 * Uses the Supabase Management API via Tauri shell plugin to bypass CORS.
 */
import { Command } from "@tauri-apps/plugin-shell";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  QueryOptions,
  QueryResult,
  SupabaseConnectionConfig,
  TableInfo,
} from "../types";

interface ManagementApiError {
  message?: string;
  error?: string;
  hint?: string;
}

export class SupabaseProvider implements IDatabaseService {
  readonly type = "supabase" as const;
  readonly config: SupabaseConnectionConfig;

  private _status: ConnectionStatus = { state: "disconnected" };
  private _connected = false;
  private schema: string;
  private projectRef: string;

  constructor(config: SupabaseConnectionConfig) {
    this.config = config;
    this.schema = config.schema ?? "public";
    this.projectRef = this.extractProjectRef(config.url);
  }

  private extractProjectRef(url: string): string {
    const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
    if (!match) {
      throw new Error(
        "Invalid Supabase URL format. Expected: https://<project-ref>.supabase.co"
      );
    }
    return match[1];
  }

  private async executeManagementApi(
    sql: string
  ): Promise<Record<string, unknown>[]> {
    const url = `https://api.supabase.com/v1/projects/${this.projectRef}/database/query`;
    const body = JSON.stringify({ query: sql });

    const command = Command.create("curl", [
      "-s",
      "-X",
      "POST",
      url,
      "-H",
      "Content-Type: application/json",
      "-H",
      `Authorization: Bearer ${this.config.accessToken}`,
      "-d",
      body,
    ]);

    const output = await command.execute();

    if (output.code !== 0) {
      throw new Error(`Request failed: ${output.stderr}`);
    }

    const responseText = output.stdout.trim();
    if (!responseText) return [];

    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`Invalid JSON response: ${responseText.slice(0, 200)}`);
    }

    if (data && typeof data === "object" && !Array.isArray(data)) {
      const errorData = data as ManagementApiError;
      if (errorData.message || errorData.error) {
        const errorMessage =
          errorData.message || errorData.error || "Unknown error";
        const hint = errorData.hint ? ` (${errorData.hint})` : "";
        throw new Error(`${errorMessage}${hint}`);
      }
    }

    return data as Record<string, unknown>[];
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    this._status = { state: "connecting" };

    try {
      await this.executeManagementApi("SELECT 1 as test");
      this._connected = true;
      this._status = { state: "connected", connectedAt: Date.now() };
    } catch (error) {
      this._connected = false;
      const message =
        error instanceof Error ? error.message : "Failed to connect";
      this._status = { state: "error", error: message };
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._status = { state: "disconnected" };
  }

  isConnected(): boolean {
    return this._connected && this._status.state === "connected";
  }

  async getTables(): Promise<TableInfo[]> {
    this.ensureConnected();

    const sql = `
      SELECT 
        table_name as name,
        table_type
      FROM information_schema.tables 
      WHERE table_schema = '${this.schema}'
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_name
    `;

    const rows = await this.executeManagementApi(sql);

    const tables: TableInfo[] = rows.map((row) => ({
      name: row.name as string,
      type: row.table_type === "VIEW" ? ("view" as const) : ("table" as const),
    }));

    const countPromises = tables.slice(0, 50).map(async (table) => {
      try {
        const countSql = `SELECT COUNT(*) as count FROM "${this.schema}"."${table.name}"`;
        const countResult = await this.executeManagementApi(countSql);
        if (countResult[0]?.count !== undefined) {
          table.rowCount = Number(countResult[0].count);
        }
      } catch {
        // Ignore count errors
      }
    });

    await Promise.allSettled(countPromises);
    return tables;
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const sql = `
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.udt_name,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT ku.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage ku
          ON tc.constraint_name = ku.constraint_name
          AND tc.table_schema = ku.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = '${this.schema}'
          AND tc.table_name = '${tableName}'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = '${this.schema}'
        AND c.table_name = '${tableName}'
      ORDER BY c.ordinal_position
    `;

    const rows = await this.executeManagementApi(sql);

    return rows.map((row) => ({
      name: row.column_name as string,
      type: (
        (row.udt_name as string) || (row.data_type as string)
      ).toUpperCase(),
      nullable: row.is_nullable === "YES",
      primaryKey: row.is_primary_key === true,
      defaultValue: row.column_default as string | null,
      autoIncrement:
        typeof row.column_default === "string" &&
        row.column_default.includes("nextval"),
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

    const startTime = performance.now();
    const offset = (page - 1) * pageSize;

    let sql = `SELECT * FROM "${this.schema}"."${tableName}"`;
    if (orderBy) {
      sql += ` ORDER BY "${orderBy}" ${orderDirection.toUpperCase()}`;
    }
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const rows = await this.executeManagementApi(sql);
    const duration = performance.now() - startTime;

    let totalCount: number | undefined;
    try {
      const countSql = `SELECT COUNT(*) as count FROM "${this.schema}"."${tableName}"`;
      const countResult = await this.executeManagementApi(countSql);
      if (countResult[0]?.count !== undefined) {
        totalCount = Number(countResult[0].count);
      }
    } catch {
      // Ignore count errors
    }

    if (!rows || rows.length === 0) {
      return {
        columns: [],
        values: [],
        rowCount: 0,
        totalCount: totalCount ?? 0,
        duration,
      };
    }

    const columns = Object.keys(rows[0]);
    return {
      columns,
      values: rows.map((row) => columns.map((col) => row[col])),
      rowCount: rows.length,
      totalCount,
      duration,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = performance.now();
    const rows = await this.executeManagementApi(sql);
    const duration = performance.now() - startTime;

    if (!rows || (Array.isArray(rows) && rows.length === 0)) {
      return { columns: [], values: [], rowCount: 0, duration };
    }

    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      columns,
      values: rows.map((row) => columns.map((col) => row[col])),
      rowCount: rows.length,
      duration,
    };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const startTime = performance.now();

    try {
      const result = await this.query(sql);
      return {
        success: true,
        rowsAffected: result.rowCount,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : "Execution failed",
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
    const values = columns.map((col) => this.formatValue(data[col]));

    const sql = `
      INSERT INTO "${this.schema}"."${tableName}" (${columns.map((col) => `"${col}"`).join(", ")})
      VALUES (${values.join(", ")})
      RETURNING *
    `;

    try {
      const result = await this.executeManagementApi(sql);
      const duration = performance.now() - startTime;
      return {
        success: true,
        rowsAffected: result.length,
        duration,
        lastInsertId: result[0]?.id as number | string | undefined,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : "Insert failed",
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
      .map(([col, val]) => `"${col}" = ${this.formatValue(val)}`)
      .join(", ");
    const whereClause = Object.entries(where)
      .map(([col, val]) => `"${col}" = ${this.formatValue(val)}`)
      .join(" AND ");

    const sql = `
      UPDATE "${this.schema}"."${tableName}"
      SET ${setClause}
      WHERE ${whereClause}
      RETURNING *
    `;

    try {
      const result = await this.executeManagementApi(sql);
      const duration = performance.now() - startTime;
      return { success: true, rowsAffected: result.length, duration };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : "Update failed",
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
      .map(([col, val]) => `"${col}" = ${this.formatValue(val)}`)
      .join(" AND ");

    const sql = `
      DELETE FROM "${this.schema}"."${tableName}"
      WHERE ${whereClause}
      RETURNING *
    `;

    try {
      const result = await this.executeManagementApi(sql);
      const duration = performance.now() - startTime;
      return { success: true, rowsAffected: result.length, duration };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : "Delete failed",
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

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    }
    return `'${String(value).replace(/'/g, "''")}'`;
  }
}

export default SupabaseProvider;
