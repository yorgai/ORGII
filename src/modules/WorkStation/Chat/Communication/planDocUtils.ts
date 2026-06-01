/**
 * Utilities for extracting plan doc content and file paths from
 * `create_plan` tool result payloads.
 */

/**
 * Sentinel Rust prefixes the `create_plan` tool_result with (see
 * `src-tauri/src/agent_core/core/tools/impls/plan_mode/create_plan.rs`:
 * `PLAN_SUBMITTED_END_TURN_PREFIX`). The JSON body after the colon is
 * `CreatePlanResult` (path, slug, hash, bytes_written, ...).
 */
export const PLAN_SUBMITTED_SENTINEL = "PLAN_SUBMITTED_END_TURN:";

/**
 * Cast an unknown value to string, returning an empty string for non-strings.
 * Used to safely read `args.content`, `args.streamContent`, etc.
 */
export function asStringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function derivePlanTitle(title: string, content: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle;

  const headingMatch = content.match(/^\s*#\s+(.+)$/m);
  return headingMatch?.[1]?.trim() ?? "";
}

function parsePlanPathFromString(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const body = trimmed.startsWith(PLAN_SUBMITTED_SENTINEL)
    ? trimmed.slice(PLAN_SUBMITTED_SENTINEL.length).trim()
    : trimmed;

  if (!body.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const path = parsed["path"];
    return typeof path === "string" && path ? path : null;
  } catch {
    return null;
  }
}

/**
 * Extract the absolute plan file path from a `create_plan` tool_result.
 *
 * Accepts every shape that has been observed at runtime:
 *  - `Value::String("PLAN_SUBMITTED_END_TURN:{...json...}")` — the real
 *    wire format from Rust's `event_handler::build_tool_result_event`.
 *    This is the hot path.
 *  - Raw JSON string of `CreatePlanResult` (older/less-sentineled
 *    variants and unit-test fixtures).
 *  - `{ content, observation }` wrapper (if a normalization layer
 *    upstream wraps the string).
 *  - Structured `{ path }` / `{ output: { path } }` / `{ success: { path } }`
 *    objects (test fixtures, future wire variants).
 *
 * Returns `null` when extraction is impossible — the caller MUST handle
 * this explicitly; there is no safe synthetic fallback.
 */
export function extractPlanPathFromResult(result: unknown): string | null {
  if (result == null) return null;

  if (typeof result === "string") {
    return parsePlanPathFromString(result);
  }

  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;

    const direct = obj["path"];
    if (typeof direct === "string" && direct) return direct;

    for (const field of ["content", "observation"] as const) {
      const raw = obj[field];
      if (typeof raw === "string") {
        const parsed = parsePlanPathFromString(raw);
        if (parsed) return parsed;
      }
    }

    for (const field of ["output", "success"] as const) {
      const nested = obj[field] as Record<string, unknown> | undefined;
      if (nested && typeof nested["path"] === "string") {
        return nested["path"] as string;
      }
    }
  }

  return null;
}
