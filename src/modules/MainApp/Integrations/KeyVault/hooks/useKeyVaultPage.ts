/**
 * Business logic hook for Key Vault (Integrations) — BYOK-only.
 *
 * Wizard open-state is read from the URL via {@link useWizardParam}:
 *
 *   ?wizard=key-add              → add a new BYOK key (CLI agent or API key)
 *   ?wizard=hosted-api-add       → add an ORGII hosted API key
 *
 * Renaming an existing account happens inline inside the table's expanded
 * card (Edit tab) — there is no standalone edit wizard.
 *
 * Listing / publishing is not part of the Key Vault. Keys live locally; any
 * marketplace flow is handled by separate surfaces.
 */
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { SaveKeyRequest as RpcSaveKeyRequest } from "@src/api/tauri/rpc/schemas/validation";
import type { ModelType, SaveKeyRequest } from "@src/api/types/keys";
import { ORGII_ORCHESTRATOR } from "@src/assets/providers";
import Message from "@src/components/Message";
import { WIZARD_IDS, buildIntegrationsPath } from "@src/config/mainAppPaths";
import { useKeyVault } from "@src/hooks/keyVault";
import { useWizardParam } from "@src/hooks/navigation";
import { clearStaleAccountIdAtom } from "@src/store/session/creatorDefaultModelAtom";

import { disconnectAccount } from "./disconnectAccount";

export function useKeyVaultPage() {
  const { t } = useTranslation("integrations");
  const navigate = useNavigate();
  const {
    accounts,
    loading,
    error,
    refresh,
    refreshAccount,
    getAccount,
    saveKey,
    deleteKey,
  } = useKeyVault();
  const clearStaleSelection = useSetAtom(clearStaleAccountIdAtom);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [agentTypeFilter, setAgentTypeFilter] = useState<ModelType | null>(
    null
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [formLoading, setFormLoading] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshingAccountId, setRefreshingAccountId] = useState<string | null>(
    null
  );

  // Wizard open-state derived from URL
  const { wizard, openWizard } = useWizardParam();
  const showAddForm = wizard === WIZARD_IDS.KEY_ADD;
  const showOrgiiAddForm = wizard === WIZARD_IDS.ORGII_API_ADD;

  const closeKeyVaultWizard = useCallback(() => {
    navigate(buildIntegrationsPath({ category: "models" }), { replace: true });
  }, [navigate]);

  // Initial load
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Computed
  const agentTypes = useMemo(
    () => [...new Set(accounts.map((acc) => acc.modelType))].sort(),
    [accounts]
  );

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      if (agentTypeFilter && acc.modelType !== agentTypeFilter) return false;

      if (searchQuery) {
        const queryLower = searchQuery.toLowerCase();
        if (
          !acc.name.toLowerCase().includes(queryLower) &&
          !acc.modelType.toLowerCase().includes(queryLower)
        )
          return false;
      }

      return true;
    });
  }, [accounts, agentTypeFilter, searchQuery]);

  const selectedAccount = useMemo(
    () => getAccount(selectedAccountId || ""),
    [getAccount, selectedAccountId]
  );

  // Handlers
  const handleAccountSelect = useCallback(
    (id: string | null) => {
      setSelectedAccountId(id);
      closeKeyVaultWizard();
    },
    [closeKeyVaultWizard]
  );

  const handleRefreshAccount = useCallback(
    async (accountId: string) => {
      setRefreshingAccountId(accountId);
      setRefreshLoading(true);
      try {
        const account = getAccount(accountId);
        const name = account?.name || "Account";
        if (account?.authMethod === "oauth") {
          await refresh();
          Message.success(t("keyVault.toasts.refreshed", { name }), 5000);
          return;
        }

        const success = await refreshAccount(accountId, true);
        if (success) {
          Message.success(t("keyVault.toasts.refreshed", { name }), 5000);
        } else {
          Message.warning(t("keyVault.toasts.refreshFailed", { name }), 5000);
        }
      } catch (err) {
        const name = getAccount(accountId)?.name || "Account";
        Message.error(t("keyVault.toasts.refreshError", { name }), 5000);
        console.error("[Refresh] Error:", err);
      } finally {
        setRefreshingAccountId(null);
        setRefreshLoading(false);
      }
    },
    [refreshAccount, refresh, getAccount, t]
  );

  const handleRefresh = useCallback(async () => {
    if (!selectedAccountId) return;
    await handleRefreshAccount(selectedAccountId);
  }, [handleRefreshAccount, selectedAccountId]);

  // Second arg (deleteType) is ignored — OSS only deletes local keys.
  const handleDisconnect = useCallback(
    (accountId: string, _deleteType?: "local" | "cloud") =>
      disconnectAccount(accountId, {
        getAccount,
        deleteKey,
        refresh,
        selectedAccountId,
        setSelectedAccountId,
        clearStaleModelSelection: clearStaleSelection,
        t,
      }),
    [getAccount, deleteKey, refresh, selectedAccountId, clearStaleSelection, t]
  );

  const handleFormSubmit = useCallback(
    async (data: RpcSaveKeyRequest) => {
      setFormLoading(true);
      try {
        const saveRequest: SaveKeyRequest = {
          ...(data as SaveKeyRequest),
          has_local_key: true,
          is_listed: false,
        };

        const saved = await saveKey(saveRequest);
        await refresh();
        closeKeyVaultWizard();
        if (saved?.id) setSelectedAccountId(saved.id);
      } catch (err) {
        Message.error(
          err instanceof Error ? err.message : t("common:status.saveFailed")
        );
        console.error("Submit error:", err);
      } finally {
        setFormLoading(false);
      }
    },
    [saveKey, refresh, t, closeKeyVaultWizard]
  );

  const handleEditAccountSave = useCallback(
    async (accountId: string, name: string, description: string) => {
      const account = getAccount(accountId);
      if (!account) return;
      try {
        await saveKey({
          id: account.id,
          agent_type: account.modelType,
          name,
          description,
        });
        await refresh();
      } catch (err) {
        Message.error(
          err instanceof Error ? err.message : t("common:status.saveFailed")
        );
        throw err;
      }
    },
    [getAccount, refresh, saveKey, t]
  );

  return {
    // Data
    accounts,
    loading: loading || refreshLoading,
    error,
    agentTypes,
    filteredAccounts,
    selectedAccount,

    // Filter state
    searchQuery,
    setSearchQuery,
    agentTypeFilter,

    // Form state
    showAddForm,
    showOrgiiAddForm,
    formLoading,
    selectedAccountId,

    // Handlers
    handleAccountSelect,
    handleAgentTypeFilter: setAgentTypeFilter,
    handleRefresh,
    handleRefreshAccount,
    refreshingAccountId,
    handleDisconnect,
    handleAddAccount: () => {
      setSelectedAccountId(null);
      openWizard(WIZARD_IDS.KEY_ADD);
    },
    handleAddOrgiiApi: () => {
      setSelectedAccountId(null);
      openWizard(WIZARD_IDS.ORGII_API_ADD);
    },
    handleFormSubmit,
    handleOrgiiApiSubmit: async (name: string, apiKey: string) => {
      setFormLoading(true);
      try {
        const saved = await saveKey({
          agent_type: ORGII_ORCHESTRATOR,
          name,
          api_key: apiKey,
          auth_method: "api_key",
        });
        await refresh();
        if (saved?.id) setSelectedAccountId(saved.id);
      } catch (err) {
        Message.error(
          err instanceof Error ? err.message : t("common:status.saveFailed")
        );
      } finally {
        setFormLoading(false);
      }
    },
    handleFormCancel: closeKeyVaultWizard,
    handleEditAccountSave,
    refresh,
    saveKey,
  };
}
