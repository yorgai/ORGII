/**
 * Neon Database Provider
 *
 * Implements IDatabaseService for Neon serverless PostgreSQL.
 * Uses the Neon serverless HTTP API via Tauri shell plugin (curl) to bypass CORS.
 */
import { Command } from "@tauri-apps/plugin-shell";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  NeonConnectionConfig,
  QueryOptions,
  QueryResult,
  TableInfo,
} from "../types";

interface NeonApiError {
  message?: string;
  code?: string;
}

interface NeonQueryRow {
  fields: { name: string; dataTypeID: number }[];
  rows: unknown[][];
  rowCount: number;
  command: string;
}

export class NeonProvider implements IDatabaseService {
  readonly type = "neon" as const;
  readonly config: NeonConnectionConfig;

  private _status: ConnectionStatus = { state: "disconnected" };
  private _connected = false;
  private apiHost: string;

  constructor(config: NeonConnectionConfig) {
    this.config = config;
    this.apiHost = this.extractApiHost(config.connectionString);
  }

  /**
   * Extract the HTTP SQL endpoint from a Neon connection string.
   * Input:  postgres://user:pass@ep-xxx-yyy-123.us-east-2.aws.neon.tech/dbname
   * Output: https://ep-xxx-yyy-123.us-east-2.aws.neon.tech
   */
  private extractApiHost(connString: string): string {
    const match = connString.match(
      /@([^/]+\.neon\.tech|[^/]+\.neon\.tech:\d+)/
    );
    if (!match) {
      throw new Error(
        "Invalid Neon connection string. Expected format: postgres://user:pass@ep-xxx.neon.tech/db"
      );
    }
    return `https://${match[1]}`;
  }

  private async executeHttp(sql: string): Promise<NeonQueryRow> {
    const url = `${this.apiHost}/sql`;
    const body = JSON.stringify({ query: sql, params: [] });

    const command = Command.create("curl", [
      "-s",
      "-X",
      "POST",
      url,
      "-H",
      "Content-Type: application/json",
      "-H",
      `Neon-Connection-String: ${this.config.connectionString}`,
      "-d",
      body,
    ]);

    const output = await command.execute();

    if (output.code !== 0) {
      throw new Error(`Neon request failed: ${output.stderr}`);
    }

    const text = output.stdout.trim();
    if (!text) {
      return { fields: [], rows: [], rowCount: 0, command: "" };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from Neon: ${text.slice(0, 200)}`);
    }

    if (data && typeof data === "object" && "message" in data) {
      const err = data as NeonApiError;
      throw new Error(err.message ?? "Unknown Neon error");
    }

    const result = data as { rows: NeonQueryRow[] };
    if (result.rows && result.rows.length > 0) {
      return result.rows[0];
    }

    return { fields: [], rows: [], rowCount: 0, command: "" };
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    this._status = { state: "connecting" };

    try {
      await this.executeHttp("SELECT 1 as test");
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

    const result = await this.executeHttp(`
      SELECT 
        table_name as name,
        table_type
      FROM information_schema.tables 
      WHERE table_schema = 'public'
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_name
    `);

    const tables: TableInfo[] = result.rows.map((row) => ({
      name: row[0] as string,
      type:
        (row[1] as string) === "VIEW" ? ("view" as const) : ("table" as const),
    }));

    for (const table of tables.slice(0, 50)) {
      try {
        const countResult = await this.executeHttp(
          `SELECT COUNT(*) as count FROM "public"."${table.name}"`
        );
        if (countResult.rows.length > 0) {
          table.rowCount = Number(countResult.rows[0][0]);
        }
      } catch {
        // Ignore count errors for individual tables
      }
    }

    return tables;
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const result = await this.executeHttp(`
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
          AND tc.table_schema = 'public'
          AND tc.table_name = '${tableName}'
      ) pk ON c.column_name = pk.column_name
      WHERE c.table_schema = 'public'
        AND c.table_name = '${tableName}'
      ORDER BY c.ordinal_position
    `);

    return result.rows.map((row) => ({
      name: row[0] as string,
      type: ((row[4] as string) || (row[1] as string)).toUpperCase(),
      nullable: row[2] === "YES",
      primaryKey: row[5] === true || row[5] === "t",
      defaultValue: row[3] as string | null,
      autoIncrement:
        typeof row[3] === "string" && (row[3] as string).includes("nextval"),
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

    let sql = `SELECT * FROM "public"."${tableName}"`;
    if (orderBy) {
      sql += ` ORDER BY "${orderBy}" ${orderDirection.toUpperCase()}`;
    }
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const result = await this.executeHttp(sql);
    const duration = performance.now() - startTime;

    let totalCount: number | undefined;
    try {
      const countResult = await this.executeHttp(
        `SELECT COUNT(*) FROM "public"."${tableName}"`
      );
      if (countResult.rows.length > 0) {
        totalCount = Number(countResult.rows[0][0]);
      }
    } catch {
      // Ignore count errors
    }

    const columns = result.fields.map((field) => field.name);
    return {
      columns,
      values: result.rows as unknown[][],
      rowCount: result.rows.length,
      totalCount,
      duration,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = performance.now();
    const result = await this.executeHttp(sql);
    const duration = performance.now() - startTime;

    const columns = result.fields.map((field) => field.name);
    return {
      columns,
      values: result.rows as unknown[][],
      rowCount: result.rows.length,
      duration,
    };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const startTime = performance.now();

    try {
      const result = await this.executeHttp(sql);
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
      INSERT INTO "public"."${tableName}" (${columns.map((col) => `"${col}"`).join(", ")})
      VALUES (${values.join(", ")})
      RETURNING *
    `;

    try {
      const result = await this.executeHttp(sql);
      return {
        success: true,
        rowsAffected: result.rowCount || 1,
        duration: performance.now() - startTime,
        lastInsertId:
          result.rows.length > 0
            ? (result.rows[0][0] as number | string | undefined)
            : undefined,
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
      UPDATE "public"."${tableName}"
      SET ${setClause}
      WHERE ${whereClause}
      RETURNING *
    `;

    try {
      const result = await this.executeHttp(sql);
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
      DELETE FROM "public"."${tableName}"
      WHERE ${whereClause}
      RETURNING *
    `;

    try {
      const result = await this.executeHttp(sql);
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

export default NeonProvider;
