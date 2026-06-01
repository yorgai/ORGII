/**
 * Shared model/accountId resolution for follow-up messages.
 *
 * Extracts the current model and accountId from LastModelSelection,
 * accounting for own-key vs hosted-key routing.
 */
import { isHostedKey } from "@src/api/tauri/session";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

export interface ResolvedMessageModel {
  model: string | undefined;
  accountId: string | undefined;
}

export function resolveModelForMessage(
  sel: LastModelSelection | null
): ResolvedMessageModel {
  if (!sel) return { model: undefined, accountId: undefined };

  const isHosted = isHostedKey(sel.keySource);
  const model = isHosted ? sel.listingModel : sel.model;
  const accountId = isHosted ? undefined : sel.selectedAccountId || undefined;

  return { model: model ?? undefined, accountId };
}
