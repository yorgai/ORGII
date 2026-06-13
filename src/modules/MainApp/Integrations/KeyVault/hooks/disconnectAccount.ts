/**
 * Account disconnect/delete logic extracted from useKeyVaultPage.
 *
 * BYOK-only: every account has a local key on disk.
 */
import type { TFunction } from "i18next";

import Message from "@src/components/Message";
import type { KeyVaultAccount, ModelType } from "@src/hooks/keyVault";
import { createLogger } from "@src/hooks/logger";
import { sessionsAtom } from "@src/store/session/sessionAtom";
import { isActiveStatus } from "@src/types/session/session";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { confirmDestructiveAction } from "@src/util/dialogs/confirmDestructiveAction";

const log = createLogger("KeyVault");

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

  // Disconnecting an account that live sessions still point at leaves
  // their `accountId` dangling — the next turn fails credential
  // resolution with no warning. List the affected sessions in the
  // confirm dialog so the user decides knowingly. We deliberately do
  // NOT auto-migrate them to another account (user must opt in to any
  // resource change per session).
  const activeSessions = getInstrumentedStore()
    .get(sessionsAtom)
    .filter(
      (session) =>
        session.accountId === accountId && isActiveStatus(session.status)
    );

  const message =
    activeSessions.length > 0
      ? `${t("keyVault.confirmRemoveMessage")}\n\n${t(
          "keyVault.confirmRemoveActiveSessions",
          { count: activeSessions.length }
        )}\n${activeSessions
          .slice(0, 5)
          .map((session) => `• ${session.name || session.session_id}`)
          .join("\n")}`
      : t("keyVault.confirmRemoveMessage");

  const confirmed = await confirmDestructiveAction({
    title: t("keyVault.confirmRemoveTitle", { name: accountLabel }),
    message,
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
    log.error("Delete error:", err);
  }
}
