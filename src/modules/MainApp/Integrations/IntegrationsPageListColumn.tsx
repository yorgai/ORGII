/**
 * Full-page detail list column for the Integrations hub.
 *
 * Only rendered when `hasFullPageDetail === true` — i.e. a category has
 * escalated its detail view to occupy the whole page (account edit,
 * skill editor, plugin browse, etc.). In this mode the left column turns
 * into either the AccountListPanel (models) or a DrillDownListPanel.
 *
 * The default (non-full) left list is rendered by AgentOrgsListPanel.
 */
import AccountListPanel from "./KeyVault/Accounts/Detail/AccountListPanel";
import type { useKeyVaultPage } from "./KeyVault/hooks/useKeyVaultPage";
import DrillDownListPanel from "./shared/DrillDownListPanel";
import type { DrillDownItem } from "./shared/DrillDownListPanel";
import type { DetailMode, IntegrationCategory } from "./types";

export interface IntegrationsPageListColumnProps {
  hasFullPageDetail: boolean;
  category: IntegrationCategory;
  onViewChange: (cat: IntegrationCategory) => void;
  accountsHook: ReturnType<typeof useKeyVaultPage>;
  accountListFiltered: ReturnType<typeof useKeyVaultPage>["filteredAccounts"];
  accountListSearch: string;
  onAccountSelect: (id: string | null, mode?: DetailMode) => void;
  onSearchChange: (query: string) => void;
  onExitFullPage: () => void;
  drillDownItems: DrillDownItem[];
  drillDownSelectedId: string | null;
  drillDownLoading: boolean;
  onDrillDownSelect: (id: string) => void;
  drillDownTitle: string;
  drillDownAddHandler: (() => void) | undefined;
}

export function IntegrationsPageListColumn({
  category,
  accountsHook,
  accountListFiltered,
  accountListSearch,
  onAccountSelect,
  onSearchChange,
  onExitFullPage,
  drillDownItems,
  drillDownSelectedId,
  drillDownLoading,
  onDrillDownSelect,
  drillDownTitle,
  drillDownAddHandler,
}: IntegrationsPageListColumnProps) {
  if (category === "models") {
    return (
      <AccountListPanel
        accounts={accountsHook.accounts}
        filteredAccounts={accountListFiltered}
        selectedAccountId={accountsHook.selectedAccountId}
        searchQuery={accountListSearch}
        loading={accountsHook.loading}
        error={accountsHook.error}
        onAccountSelect={(id) => onAccountSelect(id, "full")}
        onSearchChange={onSearchChange}
        onAddAccount={accountsHook.handleAddAccount}
        onBack={onExitFullPage}
      />
    );
  }
  return (
    <DrillDownListPanel
      items={drillDownItems}
      selectedId={drillDownSelectedId}
      loading={drillDownLoading}
      onSelect={onDrillDownSelect}
      onBack={onExitFullPage}
      title={drillDownTitle}
      onAdd={drillDownAddHandler}
    />
  );
}
