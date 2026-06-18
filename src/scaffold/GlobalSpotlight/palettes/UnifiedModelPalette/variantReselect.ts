/**
 * Decision helper for the "edit the current selection's variant" flow.
 *
 * When the user edits the effort/variant of the *currently selected* model,
 * the selected model should become that variant so the displayed pill and the
 * model the session actually launches with both update immediately. This is a
 * no-op when the variant didn't actually change (or is empty), so callers can
 * avoid a redundant config write + recent-list churn.
 */
export function resolveVariantReselection(
  currentModelId: string,
  nextModelId: string
): string | null {
  if (!nextModelId) return null;
  if (nextModelId === currentModelId) return null;
  return nextModelId;
}
