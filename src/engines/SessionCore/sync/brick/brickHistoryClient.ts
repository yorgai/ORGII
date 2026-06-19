// Typed adapter over the `brick history` command surface.
//
// This is the Stage-1 "shadow read" client from the ORGII Adapter Contract
// (docs/architecture/orgii-adapter-contract.md in Brick-Vault). It runs the
// installed `brick` binary through an injected command runner, validates JSON
// responses into versioned DTOs, and gates on the binary's reported contract
// version. It does NOT mutate ORGII state or serve UI by itself; callers use it
// for background shadow reads and parity capture until a source/command is
// promoted to Brick-primary.

/** Lowest `history_contract_version` this adapter knows how to read. */
export const MIN_SUPPORTED_HISTORY_CONTRACT_VERSION = 1;

/** Result of running the brick binary once. */
export interface BrickCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Injected command runner. Production wires this to the Tauri shell plugin;
 * tests pass a stub. Arguments are always an array (never a shell string) to
 * avoid injection, per the adapter contract.
 */
export type BrickCommandRunner = (
  args: string[],
  options: { timeoutMs: number }
) => Promise<BrickCommandResult>;

export interface BrickVersionInfo {
  name: string;
  version: string;
  metadataDbSchemaVersion: number;
  historyContractVersion: number;
}

export interface BrickHistorySession {
  sourceId: string;
  externalSessionId: string;
  sessionId: string | null;
  title: string | null;
  path: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  repoPath: string | null;
  branch: string | null;
  filesChanged: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
  touchedFiles: string[];
}

export interface BrickHistorySessionsPage {
  sourceId: string;
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  sessions: BrickHistorySession[];
}

export class BrickUnavailableError extends Error {
  constructor(
    message: string,
    readonly result?: BrickCommandResult
  ) {
    super(message);
    this.name = "BrickUnavailableError";
  }
}

export class BrickContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrickContractError";
  }
}

/** Per-command interactive timeout defaults from the adapter contract. */
const DEFAULT_TIMEOUTS_MS = {
  version: 2_000,
  sessions: 8_000,
} as const;

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJsonStdout(result: BrickCommandResult): unknown {
  if (result.timedOut) {
    throw new BrickUnavailableError("brick command timed out", result);
  }
  if (result.exitCode !== 0) {
    throw new BrickUnavailableError(
      "brick exited with code " + String(result.exitCode),
      result
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new BrickUnavailableError("brick produced non-JSON stdout", result);
  }
}

export class BrickHistoryClient {
  constructor(private readonly run: BrickCommandRunner) {}

  /** Reads the binary version/schema info used for compatibility gating. */
  async version(): Promise<BrickVersionInfo> {
    const result = await this.run(["version", "--format", "json"], {
      timeoutMs: DEFAULT_TIMEOUTS_MS.version,
    });
    const raw = parseJsonStdout(result);
    if (typeof raw !== "object" || raw === null) {
      throw new BrickContractError("version response was not an object");
    }
    const obj = raw as Record<string, unknown>;
    const historyContractVersion = asNullableNumber(
      obj.history_contract_version
    );
    if (historyContractVersion === null) {
      throw new BrickContractError(
        "version response missing history_contract_version"
      );
    }
    return {
      name: asNullableString(obj.name) ?? "brick",
      version: asNullableString(obj.version) ?? "0.0.0",
      metadataDbSchemaVersion:
        asNullableNumber(obj.metadata_db_schema_version) ?? 0,
      historyContractVersion,
    };
  }

  /** Returns true when the binary's contract version is readable by this adapter. */
  async isCompatible(): Promise<boolean> {
    try {
      const info = await this.version();
      return (
        info.historyContractVersion >= MIN_SUPPORTED_HISTORY_CONTRACT_VERSION
      );
    } catch {
      return false;
    }
  }

  /** Reads one paginated page of session metadata for a source. */
  async sessions(
    sourceId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<BrickHistorySessionsPage> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const result = await this.run(
      [
        "history",
        "sessions",
        "--source",
        sourceId,
        "--limit",
        String(limit),
        "--offset",
        String(offset),
        "--format",
        "json",
      ],
      { timeoutMs: DEFAULT_TIMEOUTS_MS.sessions }
    );
    const raw = parseJsonStdout(result);
    return parseSessionsPage(raw);
  }
}

export function parseSessionsPage(raw: unknown): BrickHistorySessionsPage {
  if (typeof raw !== "object" || raw === null) {
    throw new BrickContractError("sessions response was not an object");
  }
  const obj = raw as Record<string, unknown>;
  const sessionsRaw = obj.sessions;
  if (!Array.isArray(sessionsRaw)) {
    throw new BrickContractError("sessions response missing sessions array");
  }
  return {
    sourceId: asNullableString(obj.source_id) ?? "",
    limit: asNullableNumber(obj.limit) ?? 0,
    offset: asNullableNumber(obj.offset) ?? 0,
    total: asNullableNumber(obj.total) ?? sessionsRaw.length,
    hasMore: obj.has_more === true,
    sessions: sessionsRaw.map(parseSession),
  };
}

function parseSession(raw: unknown): BrickHistorySession {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const externalSessionId = asNullableString(obj.external_session_id);
  if (externalSessionId === null) {
    throw new BrickContractError("session row missing external_session_id");
  }
  const touchedFilesRaw = obj.touched_files;
  return {
    sourceId: asNullableString(obj.source_id) ?? "",
    externalSessionId,
    sessionId: asNullableString(obj.session_id),
    title: asNullableString(obj.title),
    path: asNullableString(obj.path),
    sizeBytes: asNullableNumber(obj.size_bytes),
    modifiedAt: asNullableString(obj.modified_at),
    createdAt: asNullableString(obj.created_at),
    updatedAt: asNullableString(obj.updated_at),
    model: asNullableString(obj.model),
    inputTokens: asNullableNumber(obj.input_tokens),
    outputTokens: asNullableNumber(obj.output_tokens),
    repoPath: asNullableString(obj.repo_path),
    branch: asNullableString(obj.branch),
    filesChanged: asNullableNumber(obj.files_changed),
    linesAdded: asNullableNumber(obj.lines_added),
    linesRemoved: asNullableNumber(obj.lines_removed),
    touchedFiles: Array.isArray(touchedFilesRaw)
      ? touchedFilesRaw.filter((f): f is string => typeof f === "string")
      : [],
  };
}
