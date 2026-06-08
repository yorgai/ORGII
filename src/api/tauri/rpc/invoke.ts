/**
 * Typed Tauri invoke wrapper with Zod validation.
 *
 * Provides runtime type safety for Tauri IPC calls by validating
 * both input parameters and output responses against Zod schemas.
 * Errors from Rust are surfaced as typed RpcError instead of raw strings.
 */
import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod/v4";

// ============================================================================
// Error types
// ============================================================================

export class RpcError extends Error {
  readonly command: string;
  readonly cause?: unknown;

  constructor(command: string, message: string, cause?: unknown) {
    super(`[RPC:${command}] ${message}`);
    this.name = "RpcError";
    this.command = command;
    this.cause = cause;
  }
}

// ============================================================================
// Procedure definition
// ============================================================================

/**
 * A single RPC procedure definition: command name + optional Zod schemas.
 *
 * - `input` validates the payload sent to Rust (catches bad args before IPC)
 * - `output` validates the response from Rust (catches schema drift early)
 * - Both are optional: omit `input` for commands with no args,
 *   omit `output` for void commands.
 */
export interface RpcProcedure<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  command: string;
  input?: TInput;
  output?: TOutput;
  /**
   * Transform Rust snake_case response to camelCase TS types.
   * Runs BEFORE Zod output validation so the schema should match
   * the transformed shape.
   */
  transform?: (raw: unknown) => unknown;
}

// ============================================================================
// Core invoke
// ============================================================================

declare global {
  interface Window {
    __orgiiE2ERpcCounts?: Record<string, number>;
    __orgiiE2ERpcLog?: Array<{ command: string; at: number }>;
  }
}

function recordE2ERpcInvoke(command: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (typeof window === "undefined") return;
  window.__orgiiE2ERpcCounts ??= {};
  window.__orgiiE2ERpcCounts[command] =
    (window.__orgiiE2ERpcCounts[command] ?? 0) + 1;
  window.__orgiiE2ERpcLog ??= [];
  window.__orgiiE2ERpcLog.push({ command, at: performance.now() });
  if (window.__orgiiE2ERpcLog.length > 500) {
    window.__orgiiE2ERpcLog.splice(0, window.__orgiiE2ERpcLog.length - 500);
  }
}

/**
 * Type-safe invoke: validates input, calls Tauri, validates output.
 *
 * In production builds, output validation is skipped for performance.
 */
export async function typedInvoke<
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
>(
  procedure: RpcProcedure<TInput, TOutput>,
  ...[payload]: z.input<TInput> extends void | undefined
    ? [payload?: undefined]
    : [payload: z.input<TInput>]
): Promise<TOutput extends z.ZodType ? z.output<TOutput> : void> {
  const { command, input, output, transform } = procedure;

  // Validate input (always — catches caller bugs before IPC round-trip)
  let validatedInput: unknown = payload;
  if (input && payload !== undefined) {
    const parsed = input.safeParse(payload);
    if (!parsed.success) {
      throw new RpcError(
        command,
        `Invalid input: ${JSON.stringify(parsed.error.issues, null, 2)}`
      );
    }
    validatedInput = parsed.data;
  }

  // Call Rust
  recordE2ERpcInvoke(command);
  let raw: unknown;
  try {
    raw = await invoke(
      command,
      (validatedInput as Record<string, unknown>) ?? {}
    );
  } catch (err) {
    throw new RpcError(
      command,
      typeof err === "string" ? err : String(err),
      err
    );
  }

  // Optional transform (snake_case → camelCase, etc.)
  const transformed = transform ? transform(raw) : raw;

  // Validate output in dev (skip in prod for perf)
  const isDev = process.env.NODE_ENV !== "production";
  if (output && isDev) {
    const parsed = output.safeParse(transformed);
    if (!parsed.success) {
      console.error(
        `[RPC:${command}] Output validation failed`,
        parsed.error.issues,
        "Raw:",
        raw
      );
      // In dev, still return the data so the app doesn't break — just warn loudly
    }
  }

  return transformed as TOutput extends z.ZodType ? z.output<TOutput> : void;
}

// ============================================================================
// Procedure builder (fluent API)
// ============================================================================

/**
 * Define a typed RPC procedure with a fluent builder:
 *
 * ```ts
 * const getUser = defineProcedure("get_user")
 *   .input(z.object({ userId: z.string() }))
 *   .output(z.object({ name: z.string(), email: z.string() }))
 *   .build();
 *
 * // Call with full type safety:
 * const user = await rpcCall(getUser, { userId: "abc" });
 * //    ^? { name: string; email: string }
 * ```
 */
export function defineProcedure(command: string) {
  return new ProcedureBuilder(command);
}

class ProcedureBuilder<
  TInput extends z.ZodType = z.ZodVoid,
  TOutput extends z.ZodType = z.ZodVoid,
> {
  private _command: string;
  private _input?: TInput;
  private _output?: TOutput;
  private _transform?: (raw: unknown) => unknown;

  constructor(command: string) {
    this._command = command;
  }

  input<T extends z.ZodType>(schema: T): ProcedureBuilder<T, TOutput> {
    const next = new ProcedureBuilder<T, TOutput>(this._command);
    next._input = schema;
    next._output = this._output;
    next._transform = this._transform;
    return next;
  }

  output<T extends z.ZodType>(schema: T): ProcedureBuilder<TInput, T> {
    const next = new ProcedureBuilder<TInput, T>(this._command);
    next._input = this._input;
    next._output = schema;
    next._transform = this._transform;
    return next;
  }

  transform(fn: (raw: unknown) => unknown): ProcedureBuilder<TInput, TOutput> {
    this._transform = fn;
    return this;
  }

  build(): RpcProcedure<TInput, TOutput> {
    return {
      command: this._command,
      input: this._input,
      output: this._output,
      transform: this._transform,
    };
  }
}

// ============================================================================
// Convenience caller
// ============================================================================

/**
 * Call a typed RPC procedure. Alias for `typedInvoke` with nicer name.
 *
 * ```ts
 * const result = await rpcCall(procedures.validation.validateKey, {
 *   agentType: "openai",
 *   apiKey: "sk-...",
 * });
 * ```
 */
export const rpcCall = typedInvoke;
