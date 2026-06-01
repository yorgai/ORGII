/**
 * Account disconnect/delete logic extracted from useKeyVaultPage.
 *
 * BYOK-only: every account has a local key on disk.
 */
import type { TFunction } from "i18next";

import Message from "@src/components/Message";
import type { KeyVaultAccount, ModelType } from "@src/hooks/keyVault";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

interface DisconnectDeps {
  getAccount: (id: string) => KeyVaultAccount | undefined;
  deleteKey: (agentType: ModelType, keyId?: string) => Promise<boolean>;
  refresh: () => Promise<void>;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  clearStaleModelSelection: (accountId: string) => void;
  t: TFunction;
}

export async function disconnectAccount(
  accountId: string,
  deps: DisconnectDeps
): Promise<void> {
  const {
    getAccount,
    deleteKey,
    refresh,
    selectedAccountId,
    setSelectedAccountId,
    clearStaleModelSelection,
    t,
  } = deps;
  const account = getAccount(accountId);
  if (!account) return;

  const accountLabel = account.name || accountId;

  const confirmed = await confirmDestructiveAction({
    title: t("keyVault.confirmRemoveTitle", { name: accountLabel }),
    message: t("keyVault.confirmRemoveMessage"),
    okLabel: t("common:actions.remove"),
    cancelLabel: t("common:actions.cancel"),
  });
  if (!confirmed) return;

  try {
    await deleteKey(account.modelType, account.id);
    Message.success(t("keyVault.toasts.localRemoved", { name: accountLabel }));

    clearStaleModelSelection(accountId);
    await refresh();
    if (selectedAccountId === accountId) {
      setSelectedAccountId(null);
    }
  } catch (err) {
    Message.error(t("keyVault.toasts.deleteError", { name: accountLabel }));
    console.error("Delete error:", err);
  }
}
