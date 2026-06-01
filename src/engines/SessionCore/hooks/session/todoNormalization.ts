/**
 * Pure helpers for normalising raw todo payloads (from Rust SQLite
 * via `getTodos`) into the in-memory `TodoItem` shape used by the
 * UI.
 *
 * Pulled out of `useTodoSync.ts` so they:
 *   1. Have no transitive jotai-atom imports (the atom modules pull
 *      in `localStorage` via `atomWithStorage`, which is undefined
 *      in Node-environment tests).
 *   2. Can be unit-tested as pure functions without spinning up a
 *      React tree.
 *
 * Both `normalizePersistedTodo` and `normalizePersistedTodoList`
 * are exported from `useTodoSync.ts` as well to keep the call
 * site / test site symmetric.
 */
// Local copy of `TodoItem` (kept in sync with `@src/store/ui/todoAtom`).
//
// Using a local copy — rather than `import type { TodoItem } from
// "@src/store/ui/todoAtom"` — avoids the transitive runtime import
// chain (`todoAtom → viewAtom → atomWithStorage → localStorage`) that
// breaks the file under Vitest's Node environment even though we only
// need a type reference. Pure types are erased at runtime in TypeScript,
// but `import type` resolution still touches the module graph during
// module-loading in some bundler configurations.
//
// The structural type below is reused by the function signatures.
// Any consumer that re-uses these helpers will get its TodoItem from
// the canonical atom module; this file's local definition exists
// purely to keep the module dependency tree narrow.
interface TodoItem {
  id: string;
  content: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  blockedBy?: number[];
}

const INTERNAL_PLAN_ARTIFACT_TOKEN =
  /(?:^|\s)([`'"(]?)(?:[^\s`'"()]*[\\/])?[\w.-]+\.plan\.md([`'"),.;:!?]?)(?=$|\s)/gi;
const ONLY_INTERNAL_PLAN_ARTIFACT =
  /^[`'"]?(?:[^\s`'"]*[\\/])?[\w.-]+\.plan\.md[`'"]?$/i;
const APPROVED_PLAN_LABEL = "approved plan";
const IMPLEMENT_APPROVED_PLAN_LABEL = "Implement approved plan";

export function sanitizeTodoDisplayText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (ONLY_INTERNAL_PLAN_ARTIFACT.test(trimmed)) {
    return IMPLEMENT_APPROVED_PLAN_LABEL;
  }

  const sanitized = trimmed
    .replace(INTERNAL_PLAN_ARTIFACT_TOKEN, (match, prefix, suffix) => {
      const leadingSpace = match.startsWith(" ") ? " " : "";
      return `${leadingSpace}${prefix}${APPROVED_PLAN_LABEL}${suffix}`;
    })
    .replace(/\s+/g, " ")
    .trim();

  return sanitized === APPROVED_PLAN_LABEL
    ? IMPLEMENT_APPROVED_PLAN_LABEL
    : sanitized;
}

/**
 * Shape of the raw todo item returned by `getTodos(sessionId)`.
 *
 * The Rust side serialises the SQLite row with optional / nullable
 * fields, so consumers can't assume any particular field is
 * present. We normalise here and skip downstream null-checks.
 */
export interface RawPersistedTodoItem {
  id?: string | null;
  content?: string | null;
  activeForm?: string | null;
  status?: TodoItem["status"] | null;
  blockedBy?: number[] | null;
}

/**
 * Normalise one raw persisted todo row into the in-memory `TodoItem`
 * shape used by the rest of the app.
 *
 * Behaviour:
 *   - `id` defaults to `"persisted-{idx}"` so a missing id never
 *     collapses two rows into one in a Map keyed by id.
 *   - `content` defaults to `""` (already true of `TodoItem.content`
 *     by convention, but doing it explicitly avoids null leaks).
 *   - `activeForm` is preserved only when it's a non-empty string.
 *   - `status` defaults to `"pending"`.
 *   - `blockedBy` is preserved only when it's a non-empty array
 *     (mirrors the canonical `TodoItem` invariant: absent === empty).
 */
export function normalizePersistedTodo(
  raw: RawPersistedTodoItem,
  idx: number
): TodoItem {
  const blockedBy = Array.isArray(raw.blockedBy) ? raw.blockedBy : undefined;
  return {
    id: raw.id || `persisted-${idx}`,
    content: sanitizeTodoDisplayText(raw.content || ""),
    activeForm:
      typeof raw.activeForm === "string" && raw.activeForm.length > 0
        ? sanitizeTodoDisplayText(raw.activeForm)
        : undefined,
    status: raw.status || "pending",
    ...(blockedBy && blockedBy.length > 0 ? { blockedBy } : {}),
  };
}

/**
 * Normalise an entire array of raw persisted todo rows. Returns an
 * empty array for non-array inputs (defensive — the Rust serde
 * shape has changed across releases, and a future migration could
 * swap the wire format from `array` to `{items: array}`; either
 * way the hook callers should still receive a typed `TodoItem[]`
 * rather than crashing on `items.map is not a function`).
 */
export function normalizePersistedTodoList(
  items: readonly unknown[] | null | undefined
): TodoItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item, idx) =>
    normalizePersistedTodo(
      (item as RawPersistedTodoItem | undefined) ?? {},
      idx
    )
  );
}

/**
 * Discriminate todo-load rejections from getTodos.
 *
 * The hook treats "session is not a coding agent" / "not supported"
 * rejections as expected (the user opened a CLI session that has
 * no todo table) and silences them. All other rejections — Tauri
 * transport failure, schema mismatch, Rust panic — are surfaced via
 * console.warn so they can be diagnosed.
 *
 * Exported for unit tests so the discrimination logic itself can
 * be locked down rather than re-implemented inline in the hook.
 */
export function isExpectedTodoLoadRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes("not a coding agent") || message.includes("not supported")
  );
}
