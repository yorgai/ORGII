/**
 * Shared surface for the `SyncSection` component family.
 *
 * Holds the small set of helpers that are referenced by more than one panel.
 * Single-owner helpers and constants live alongside their owning component file.
 */
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}
