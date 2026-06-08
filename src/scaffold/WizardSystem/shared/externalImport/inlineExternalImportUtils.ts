import type { ExternalImportRow } from "./useExternalImport";

/**
 * Stable key for a detected external-import row. Combines all four identity
 * fields so that the same artifact in different scopes (global vs. repo-scoped)
 * produces distinct keys.
 */
export function inlineExternalImportRowKey(row: {
  sourceAgent: ExternalImportRow["sourceAgent"];
  sourcePath: string;
  suggestedName: string;
  targetRepoPath: string | null;
}): string {
  return `${row.sourceAgent}:${row.sourcePath}:${row.suggestedName}:${row.targetRepoPath ?? "global"}`;
}

/**
 * Determines whether there are importable items based on the selected check
 * strategy:
 * - "all"      — checks `allImportableItems` (items not yet imported at all)
 * - "filtered" — checks `importableItems`    (items passing the current filter)
 *
 * Returns `true` when at least one item is available.
 */
export function resolveHasImportable(
  strategy: "all" | "filtered",
  allImportableItems: readonly unknown[],
  importableItems: readonly unknown[]
): boolean {
  return strategy === "all"
    ? allImportableItems.length > 0
    : importableItems.length > 0;
}
