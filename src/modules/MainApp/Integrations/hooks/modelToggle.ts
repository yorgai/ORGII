/**
 * Model toggle logic extracted from useExtensionsState.
 */
import { saveKey } from "@src/api/services/keyValidation";
import type { KeyVaultAccount } from "@src/hooks/keyVault";

export async function toggleModelForAccounts(
  model: string,
  agentType: string,
  enabled: boolean,
  accounts: KeyVaultAccount[],
  refreshAccounts: () => Promise<void>
): Promise<void> {
  const targetAccounts = accounts.filter(
    (acc) =>
      acc.modelType === agentType && (acc.availableModels ?? []).includes(model)
  );
  try {
    await Promise.all(
      targetAccounts.map((acc) => {
        const currentEnabled = new Set(acc.enabledModels ?? []);
        if (enabled) {
          currentEnabled.add(model);
        } else {
          currentEnabled.delete(model);
        }
        return saveKey({
          id: acc.id,
          agent_type: acc.modelType,
          available_models: acc.availableModels ?? [],
          enabled_models: [...currentEnabled],
        });
      })
    );
  } finally {
    // Always refresh so optimistic UI state is cleared against server truth,
    // whether the save succeeded or failed.
    await refreshAccounts();
  }
}
