import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { formatModelAgentType } from "@src/assets/providers";
import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import { MODEL_TABLE_SWITCH_SIZE } from "@src/components/ModelTable/types";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
  type SettingsTableSelectFilter,
} from "@src/components/SettingsTable";
import Switch from "@src/components/Switch";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { groupModels } from "@src/util/modelGrouping";

import { EnabledFractionText } from "../../../shared/EnabledFractionText";
import { KEY_VAULT_STATUS_DOT } from "../../statusColors";
import AccountInlineExpandedCard, {
  ACCOUNT_INLINE_TAB,
  type AccountInlineTab,
} from "./AccountInlineExpandedCard";

interface MyAccountsTableSectionProps {
  accounts: KeyVaultAccount[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectFilters: SettingsTableSelectFilter[];
  onAdd: () => void;
  onEditAccount?: (accountId: string) => void;
  onDisconnectAccount?: (
    accountId: string,
    deleteType?: "local" | "cloud"
  ) => void;
  onRefreshAccounts?: () => Promise<void>;
  onRevalidateAccount?: (accountId: string) => Promise<void>;
  refreshingAccountId?: string | null;
  onToggleAccount: (account: KeyVaultAccount, enabled: boolean) => void;
  isAccountEnabled: (account: KeyVaultAccount) => boolean;
  onToggleModel?: (
    model: string,
    agentType: string,
    enabled: boolean,
    accountId?: string
  ) => void;
  onUpdateAccountEnabledModels?: (
    accountId: string,
    agentType: string,
    enabledModels: readonly string[]
  ) => void;
  onUpdateAccountDefaultVariant?: (
    accountId: string,
    baseModel: string,
    model: string
  ) => void;
  onEditAccountSave?: (
    accountId: string,
    name: string,
    description: string
  ) => Promise<void>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function getAccountModelGroupFraction(account: KeyVaultAccount): {
  enabled: number;
  total: number;
} {
  const available = account.availableModels ?? [];
  if (available.length === 0) return { enabled: 0, total: 0 };
  const groups = groupModels([...available]);
  const enabledSet = new Set(account.enabledModels ?? []);
  const enabled = groups.reduce(
    (acc, group) =>
      group.models.some((m) => enabledSet.has(m)) ? acc + 1 : acc,
    0
  );
  return { enabled, total: groups.length };
}

export default function MyAccountsTableSection({
  accounts,
  loading,
  searchQuery,
  onSearchChange,
  selectFilters,
  onAdd,
  onEditAccount,
  onDisconnectAccount,
  onRefreshAccounts,
  onRevalidateAccount,
  refreshingAccountId,
  onToggleAccount,
  isAccountEnabled,
  onToggleModel,
  onUpdateAccountEnabledModels,
  onUpdateAccountDefaultVariant,
  onEditAccountSave,
  t,
}: MyAccountsTableSectionProps) {
  const [expandedAccountKeys, setExpandedAccountKeys] = useState<string[]>([]);
  const [activeInlineTab, setActiveInlineTab] = useState<AccountInlineTab>(
    ACCOUNT_INLINE_TAB.STATUS
  );
  const [editRequestedAccountId, setEditRequestedAccountId] = useState<
    string | null
  >(null);

  const setSingleExpandedAccount = useCallback((account: KeyVaultAccount) => {
    setExpandedAccountKeys((currentKeys) => {
      const collapsing = currentKeys.includes(account.id);
      if (collapsing) {
        setEditRequestedAccountId(null);
        return [];
      }
      return [account.id];
    });
  }, []);

  const handleEditAccountInline = useCallback(
    (accountId: string) => {
      setExpandedAccountKeys([accountId]);
      setEditRequestedAccountId(accountId);
      setActiveInlineTab(ACCOUNT_INLINE_TAB.EDIT);
      onEditAccount?.(accountId);
    },
    [onEditAccount]
  );

  const handleEditCancel = useCallback(() => {
    setEditRequestedAccountId(null);
    setActiveInlineTab(ACCOUNT_INLINE_TAB.STATUS);
  }, []);

  const handleActiveTabChange = useCallback((tab: AccountInlineTab) => {
    setActiveInlineTab(tab);
    if (tab !== ACCOUNT_INLINE_TAB.EDIT) {
      setEditRequestedAccountId(null);
    }
  }, []);

  const columns = useMemo<SettingsTableColumn<KeyVaultAccount>[]>(
    () => [
      {
        key: "provider",
        label: t("common:labels.provider"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) =>
          formatModelAgentType(rowA.modelType).localeCompare(
            formatModelAgentType(rowB.modelType)
          ),
        renderCell: (account) => (
          <span
            className={`${SETTINGS_TABLE_CELL.value} inline-flex items-center gap-2`}
          >
            <ModelIcon agentType={account.modelType} size="small" />
            {formatModelAgentType(account.modelType)}
          </span>
        ),
      },
      {
        key: "name",
        label: t("common:labels.name"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (rowA, rowB) => rowA.name.localeCompare(rowB.name),
        renderCell: (account) => (
          <span
            className={`${SETTINGS_TABLE_CELL.primary} inline-flex items-center gap-1.5 font-bold`}
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${KEY_VAULT_STATUS_DOT[account.status] ?? "bg-fill-3"}`}
            />
            {account.name}
          </span>
        ),
      },
      {
        key: "models",
        label: t("common:labels.model"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => {
          const fractionA = getAccountModelGroupFraction(rowA);
          const fractionB = getAccountModelGroupFraction(rowB);
          return fractionA.enabled - fractionB.enabled;
        },
        renderCell: (account) => {
          const { enabled, total } = getAccountModelGroupFraction(account);
          if (total === 0) return null;
          return <EnabledFractionText enabled={enabled} total={total} />;
        },
      },
      {
        key: "added",
        label: t("tableHeaders.added"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => {
          const timeA = rowA.connectedAt?.getTime() ?? 0;
          const timeB = rowB.connectedAt?.getTime() ?? 0;
          return timeA - timeB;
        },
        renderCell: (account) => {
          if (!account.connectedAt) return null;
          const isThisYear =
            account.connectedAt.getFullYear() === new Date().getFullYear();
          return (
            <span className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap`}>
              {account.connectedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                ...(isThisYear ? {} : { year: "numeric" }),
              })}
            </span>
          );
        },
      },
      {
        key: "enabled",
        label: <span className="sr-only">{t("common:labels.status")}</span>,
        width: SETTINGS_TABLE_COL.hug,
        align: "right",
        sorter: (rowA, rowB) =>
          Number(isAccountEnabled(rowA)) - Number(isAccountEnabled(rowB)),
        renderCell: (account) => {
          const showEdit =
            !account.listingId &&
            account.hasLocalKey &&
            Boolean(onEditAccountSave);

          return (
            <div
              className="flex items-center justify-end gap-2 whitespace-nowrap"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Switch
                size={MODEL_TABLE_SWITCH_SIZE}
                checked={isAccountEnabled(account)}
                onChange={(checked) => onToggleAccount(account, checked)}
              />
              {showEdit ? (
                <Button
                  variant="secondary"
                  size="small"
                  icon={<Pencil size={14} />}
                  iconOnly
                  onClick={() => handleEditAccountInline(account.id)}
                  aria-label={t("common:actions.edit")}
                  title={t("common:actions.edit")}
                />
              ) : null}
              {onDisconnectAccount ? (
                <Button
                  variant="danger"
                  appearance="outline"
                  size="small"
                  icon={<Trash2 size={14} />}
                  iconOnly
                  onClick={() => onDisconnectAccount(account.id)}
                  aria-label={
                    account.hasLocalKey
                      ? t("common:actions.remove")
                      : t("common:actions.delete")
                  }
                  title={
                    account.hasLocalKey
                      ? t("common:actions.remove")
                      : t("common:actions.delete")
                  }
                />
              ) : null}
            </div>
          );
        },
      },
    ],
    [
      handleEditAccountInline,
      isAccountEnabled,
      onDisconnectAccount,
      onEditAccountSave,
      onToggleAccount,
      t,
    ]
  );

  const renderExpandedAccountCard = useCallback(
    (account: KeyVaultAccount) => (
      <AccountInlineExpandedCard
        account={account}
        activeTab={activeInlineTab}
        onActiveTabChange={handleActiveTabChange}
        isAccountEnabled={isAccountEnabled(account)}
        onToggleAccount={onToggleAccount}
        onToggleModel={onToggleModel}
        onUpdateAccountEnabledModels={onUpdateAccountEnabledModels}
        onUpdateAccountDefaultVariant={onUpdateAccountDefaultVariant}
        onRefresh={onRefreshAccounts}
        onRevalidateAccount={onRevalidateAccount}
        refreshing={refreshingAccountId === account.id}
        onEditSave={onEditAccountSave}
        editRequested={editRequestedAccountId === account.id}
        onEditCancel={handleEditCancel}
      />
    ),
    [
      activeInlineTab,
      editRequestedAccountId,
      handleActiveTabChange,
      handleEditCancel,
      isAccountEnabled,
      onEditAccountSave,
      onRefreshAccounts,
      onRevalidateAccount,
      onToggleAccount,
      onToggleModel,
      onUpdateAccountEnabledModels,
      onUpdateAccountDefaultVariant,
      refreshingAccountId,
    ]
  );

  const expandable = useMemo(
    () => ({
      rowExpandable: () => true,
      expandedRowRender: renderExpandedAccountCard,
      expandedRowKeys: expandedAccountKeys,
      onExpandedRowsChange: (keys: string[]) => {
        const next = keys.slice(-1);
        setExpandedAccountKeys(next);
        if (next.length === 0) {
          setEditRequestedAccountId(null);
        }
      },
    }),
    [expandedAccountKeys, renderExpandedAccountCard]
  );

  const addKeyButton = (
    <Button
      variant="secondary"
      size="default"
      icon={<Plus size={14} />}
      onClick={onAdd}
      data-testid="key-vault-add-account-button"
    >
      {t("keyVault.addAccount")}
    </Button>
  );

  return (
    <SettingsTable<KeyVaultAccount>
      hover
      loading={loading}
      selectFilters={selectFilters}
      columns={columns}
      rows={accounts}
      getRowKey={(account) => account.id}
      rowDataTestId={(account) => `key-vault-account-row-${account.id}`}
      onRowClick={setSingleExpandedAccount}
      expandable={expandable}
      headerHeight="tall"
      className="table-expanded-no-hover table-settings-expanded-compact"
      searchBar={{
        searchValue: searchQuery,
        onSearchChange,
        searchPlaceholder: t("keyVault.searchPlaceholder"),
        allowSearchClear: true,
        rightContent: addKeyButton,
      }}
      emptyTitle={t("keyVault.noAccountsFound")}
      emptyAction={{
        label: t("keyVault.addAccount"),
        onClick: onAdd,
      }}
    />
  );
}
