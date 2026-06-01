/**
 * Shared compatibility predicate for model+source pairs.
 *
 * Used by:
 *   - `UnifiedModelPalette` to filter the Recent tab
 *   - `useValidatedLastPair` to gate the last-used pair on pill display
 *
 * A pair is compatible iff:
 *   - ORGII tier model → pool enabled + tier ID exists in categories
 *   - hosted_key     → pool enabled + model exists in ORGII model set
 *   - own_key         → account exists, status === "ready", hasKey, and
 *                       the model is enabled on that account
 *
 * Accounts passed in should already be narrowed to the current dispatch
 * context (e.g. via `getCliCompatibleAccounts` for CLI sessions).
 */
import { KEY_SOURCE } from "@src/api/tauri/session";
import {
  isOrgiiTierModel,
  parseOrgiiTierId,
} from "@src/config/orgiiCategories";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { accountHasModel } from "@src/hooks/models/useModelAccountLookup";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import type { ORGIIPoolCategory } from "@src/types/model/pool";

export interface PairCompatibilityContext {
  /** Accounts already narrowed to the current dispatch/CLI-agent context. */
  accounts: KeyVaultAccount[];
  /** False when current dispatch is a CLI agent (they never use ORGII pool). */
  orgiiPoolEnabled: boolean;
  /** modelId → pool category. */
  orgiiModelSet: ReadonlyMap<string, ORGIIPoolCategory>;
  /** Set of valid tier IDs loaded from the ORGII pool config. */
  orgiiCategoryIds: ReadonlySet<string>;
}

export function resolveCompatibleOwnKeyAccount(
  pair: RecentModelEntry,
  accounts: KeyVaultAccount[]
): KeyVaultAccount | null {
  if (!pair.accountId) return null;

  const currentAccount = accounts.find(
    (account) =>
      account.id === pair.accountId &&
      account.status === "ready" &&
      account.hasKey &&
      accountHasModel(account, pair.modelId)
  );
  if (currentAccount) return currentAccount;

  if (!pair.accountName) return null;
  return (
    accounts.find(
      (account) =>
        account.name === pair.accountName &&
        account.modelType === pair.modelType &&
        account.status === "ready" &&
        account.hasKey &&
        accountHasModel(account, pair.modelId)
    ) ?? null
  );
}

export function isPairCompatible(
  pair: RecentModelEntry,
  ctx: PairCompatibilityContext
): boolean {
  if (isOrgiiTierModel(pair.modelId)) {
    if (!ctx.orgiiPoolEnabled) return false;
    const tierId = parseOrgiiTierId(pair.modelId);
    return ctx.orgiiCategoryIds.has(tierId);
  }

  if (pair.sourceType === KEY_SOURCE.HOSTED) {
    if (!ctx.orgiiPoolEnabled) return false;
    return ctx.orgiiModelSet.has(pair.modelId);
  }

  return resolveCompatibleOwnKeyAccount(pair, ctx.accounts) !== null;
}
