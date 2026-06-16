/**
 * diffScope
 *
 * Pure (React-free) logic backing the per-round Diff scoping introduced for
 * the chat `TurnFilesFooter` "Review" affordance. Kept separate from the
 * `SessionReplayDiff` component so the "is this scope active?" / "filter the
 * file list to the scoped paths" decisions are unit-testable without
 * rendering the diff app.
 *
 * Scope semantics (see `simulatorDiffScopeRequestAtom`):
 * - `null` scope, empty `filePaths`, or a session mismatch → inactive, and
 *   the diff app behaves exactly as before (whole-session diff).
 * - active scope → the file list is narrowed to the scoped paths. If none of
 *   the scoped files survive in the current working diff (e.g. all reverted)
 *   we fall back to the full list rather than showing an empty review.
 */
import type { SimulatorDiffScopeRequest } from "@src/store/ui/simulatorAtom";

/** Minimal shape the filter needs from a diff navigation/section item. */
export interface DiffScopeItemLike {
  file: { path: string };
}

/**
 * A scope is active only when it carries at least one path AND (when it
 * declares a session) that session matches the one currently on screen. The
 * session guard makes scope self-clearing across session switches: a stale
 * scope tied to a previous session simply becomes inactive.
 */
export function isDiffScopeActive(
  scope: SimulatorDiffScopeRequest | null | undefined,
  currentSessionId: string | null | undefined
): boolean {
  if (!scope) return false;
  if (!scope.filePaths || scope.filePaths.length === 0) return false;
  if (
    scope.sessionId &&
    currentSessionId &&
    scope.sessionId !== currentSessionId
  ) {
    return false;
  }
  return true;
}

/**
 * Narrow a diff file list to the scoped path set. Returns a new array.
 *
 * - inactive scope → the list unchanged (full-session diff).
 * - active scope with matches → only the matching items.
 * - active scope with zero matches → the full list (graceful degradation;
 *   avoids a confusing empty "Review" when scoped files were reverted).
 */
export function filterDiffSectionsByScope<T extends DiffScopeItemLike>(
  items: readonly T[],
  scope: SimulatorDiffScopeRequest | null | undefined,
  currentSessionId: string | null | undefined
): T[] {
  if (!isDiffScopeActive(scope, currentSessionId)) {
    return [...items];
  }
  const scopedPaths = new Set(scope!.filePaths);
  const matched = items.filter((item) => scopedPaths.has(item.file.path));
  return matched.length > 0 ? matched : [...items];
}

/**
 * The path the diff app should scroll to / focus when a scope opens. Only the
 * clicked row (`selectedPath`) qualifies, and only when it is part of the
 * scope set. Returns `null` for the bare "Review" case (no single file) or an
 * inactive scope.
 */
export function resolveScopedSelectedPath(
  scope: SimulatorDiffScopeRequest | null | undefined,
  currentSessionId: string | null | undefined
): string | null {
  if (!isDiffScopeActive(scope, currentSessionId)) return null;
  const selected = scope!.selectedPath;
  if (selected && scope!.filePaths.includes(selected)) return selected;
  return null;
}
