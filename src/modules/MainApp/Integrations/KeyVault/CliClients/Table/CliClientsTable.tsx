import { Plus } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ModelType } from "@src/api/types/keys";
import { isApiKeyProvider } from "@src/assets/providers";
import Button from "@src/components/Button";
import ModelIcon from "@src/components/ModelIcon";
import type { SelectOption } from "@src/components/Select";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
  type SettingsTableSelectFilter,
} from "@src/components/SettingsTable";
import StatusDot from "@src/components/StatusDot";
import type { AvailableAgent } from "@src/config/cliAgents";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import {
  getCliCompatibleAccounts,
  useAgentCompatibility,
} from "@src/hooks/models/useAgentCompatibility";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { openAgentConfigInWorkStation } from "@src/util/ui/openAgentConfigInWorkStation";

import CliClientInlineExpandedCard, {
  CLI_CLIENT_INLINE_TAB,
  type CliClientInlineTab,
} from "./CliClientInlineExpandedCard";

const INSTALL_FILTER = {
  ALL: "all",
  INSTALLED: "installed",
  NOT_INSTALLED: "not_installed",
} as const;

type InstallFilter = (typeof INSTALL_FILTER)[keyof typeof INSTALL_FILTER];

const READY_FILTER = {
  ALL: "all",
  READY: "ready",
  NO_KEYS: "no_keys",
} as const;

type ReadyFilter = (typeof READY_FILTER)[keyof typeof READY_FILTER];

interface CliClientsTableProps {
  agents: AvailableAgent[];
  accounts?: KeyVaultAccount[];
  loading: boolean;
  error: string | null;
  fetchAgents?: () => Promise<void>;
  onAdd?: () => void;
  cliAgents?: {
    actionMap: Record<string, "installing" | "detecting" | null>;
    handleInstall: (agentName: string, installCmd?: string) => Promise<void>;
    handleUninstall: (
      agentName: string,
      uninstallCmd?: string
    ) => Promise<void>;
  };
}

const CliClientsTable: React.FC<CliClientsTableProps> = ({
  agents,
  accounts = [],
  loading,
  error,
  fetchAgents,
  onAdd,
  cliAgents,
}) => {
  const { t } = useTranslation("settings");
  const { t: tIntegrations } = useTranslation("integrations");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAgentKeys, setExpandedAgentKeys] = useState<string[]>([]);
  const [activeInlineTab, setActiveInlineTab] = useState<CliClientInlineTab>(
    CLI_CLIENT_INLINE_TAB.STATUS
  );
  const [installFilter, setInstallFilter] = useState<InstallFilter>(
    INSTALL_FILTER.ALL
  );
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>(READY_FILTER.ALL);
  const { registry } = useAgentCompatibility();

  const credentialsByAgent = useMemo(() => {
    const planMap = new Map<string, number>();
    const keyMap = new Map<string, number>();
    for (const agent of agents) {
      const readyAccounts = getCliCompatibleAccounts(
        registry,
        agent.name,
        accounts
      );
      let planCount = 0;
      let keyCount = 0;
      for (const acc of readyAccounts) {
        if (isApiKeyProvider(acc.modelType)) {
          keyCount += 1;
        } else {
          planCount += 1;
        }
      }
      if (planCount > 0) planMap.set(agent.name, planCount);
      if (keyCount > 0) keyMap.set(agent.name, keyCount);
    }
    return { planMap, keyMap };
  }, [agents, accounts, registry]);

  const installFilterOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: INSTALL_FILTER.ALL,
        label: tIntegrations("cliTable.filterAllInstall"),
      },
      {
        value: INSTALL_FILTER.INSTALLED,
        label: t("cliConfig.installed"),
      },
      {
        value: INSTALL_FILTER.NOT_INSTALLED,
        label: t("cliConfig.statusNotInstalled"),
      },
    ],
    [t, tIntegrations]
  );

  const readyFilterOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: READY_FILTER.ALL,
        label: tIntegrations("cliTable.filterAllReady"),
      },
      {
        value: READY_FILTER.READY,
        label: tIntegrations("cliTable.filterReady"),
      },
      {
        value: READY_FILTER.NO_KEYS,
        label: tIntegrations("cliTable.filterNoKeys"),
      },
    ],
    [tIntegrations]
  );

  const setSingleExpandedAgent = useCallback((agent: AvailableAgent) => {
    setExpandedAgentKeys((currentKeys) =>
      currentKeys.includes(agent.name) ? [] : [agent.name]
    );
  }, []);

  const handleViewAgent = useCallback((agent: AvailableAgent) => {
    openAgentConfigInWorkStation({
      variant: "cli",
      entityId: agent.name,
      displayName: agent.displayName,
      cliAgentType: agent.name,
    });
  }, []);

  const cliSelectFilters = useMemo<SettingsTableSelectFilter[]>(
    () => [
      {
        key: "install",
        value: installFilter,
        defaultValue: INSTALL_FILTER.ALL,
        options: installFilterOptions,
        onChange: (val) => setInstallFilter(val as InstallFilter),
      },
      {
        key: "ready",
        value: readyFilter,
        defaultValue: READY_FILTER.ALL,
        options: readyFilterOptions,
        onChange: (val) => setReadyFilter(val as ReadyFilter),
      },
    ],
    [installFilter, installFilterOptions, readyFilter, readyFilterOptions]
  );

  const columns: SettingsTableColumn<AvailableAgent>[] = useMemo(
    () => [
      {
        key: "agent",
        label: t("cliConfig.tableAgent"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (agentA, agentB) =>
          agentA.displayName.localeCompare(agentB.displayName),
        renderCell: (agent) => (
          <span
            className={`${SETTINGS_TABLE_CELL.primary} inline-flex items-center gap-2`}
          >
            <ModelIcon agentType={agent.name as ModelType} size={16} />
            {agent.displayName}
          </span>
        ),
      },
      {
        key: "installedStatus",
        label: t("cliConfig.tableInstalled"),
        width: "110px",
        sorter: (agentA, agentB) =>
          Number(agentB.installed) - Number(agentA.installed),
        renderCell: (agent) => (
          <StatusDot
            color={agent.installed ? "bg-success-6" : "bg-fill-3"}
            size="inline"
            labelClassName={
              agent.installed
                ? "text-[12px] text-text-2"
                : "text-[12px] text-text-3"
            }
            label={
              agent.installed
                ? t("cliConfig.installed")
                : t("cliConfig.statusNotInstalled")
            }
          />
        ),
      },
      {
        key: "compatibleKeys",
        label: tIntegrations("cliPreview.compatibleKeys"),
        width: "130px",
        sorter: (agentA, agentB) => {
          const totalA =
            (credentialsByAgent.keyMap.get(agentA.name) ?? 0) +
            (credentialsByAgent.planMap.get(agentA.name) ?? 0);
          const totalB =
            (credentialsByAgent.keyMap.get(agentB.name) ?? 0) +
            (credentialsByAgent.planMap.get(agentB.name) ?? 0);
          return totalB - totalA;
        },
        renderCell: (agent) => {
          const keyCount = credentialsByAgent.keyMap.get(agent.name) ?? 0;
          const planCount = credentialsByAgent.planMap.get(agent.name) ?? 0;
          const total = keyCount + planCount;

          if (total === 0) {
            return (
              <StatusDot
                color="bg-fill-3"
                size="inline"
                labelClassName="text-[12px] text-text-3"
                label={t("dependencies.notFound")}
              />
            );
          }

          return (
            <StatusDot
              color="bg-success-6"
              size="inline"
              labelClassName="text-[12px] text-text-2"
              label={t("cliConfig.keysAdded")}
              count={total}
            />
          );
        },
      },
      {
        key: "actions",
        label: (
          <span className="sr-only">
            {tIntegrations("common:labels.actions", {
              defaultValue: "Actions",
            })}
          </span>
        ),
        width: SETTINGS_TABLE_COL.hug,
        align: "right",
        renderCell: (agent) => (
          <div onClick={(event) => event.stopPropagation()}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => handleViewAgent(agent)}
            >
              {tIntegrations("common:actions.view", { defaultValue: "View" })}
            </Button>
          </div>
        ),
      },
    ],
    [t, tIntegrations, credentialsByAgent, handleViewAgent]
  );

  const renderExpandedAgentCard = useCallback(
    (agent: AvailableAgent) => (
      <CliClientInlineExpandedCard
        agent={agent}
        accounts={accounts}
        activeTab={activeInlineTab}
        onActiveTabChange={setActiveInlineTab}
        onRefresh={fetchAgents}
        onAdd={onAdd}
        cliAgents={cliAgents}
      />
    ),
    [accounts, activeInlineTab, cliAgents, fetchAgents, onAdd]
  );

  const expandable = useMemo(
    () => ({
      rowExpandable: () => true,
      expandedRowRender: renderExpandedAgentCard,
      expandedRowKeys: expandedAgentKeys,
      onExpandedRowsChange: (keys: string[]) => {
        setExpandedAgentKeys(keys.slice(-1));
      },
    }),
    [expandedAgentKeys, renderExpandedAgentCard]
  );

  const filtered = useMemo(() => {
    let rows = agents;

    if (installFilter === INSTALL_FILTER.INSTALLED) {
      rows = rows.filter((agent) => agent.installed);
    } else if (installFilter === INSTALL_FILTER.NOT_INSTALLED) {
      rows = rows.filter((agent) => !agent.installed);
    }

    if (readyFilter === READY_FILTER.READY) {
      rows = rows.filter((agent) => {
        const plans = credentialsByAgent.planMap.get(agent.name) ?? 0;
        const keys = credentialsByAgent.keyMap.get(agent.name) ?? 0;
        return plans + keys > 0;
      });
    } else if (readyFilter === READY_FILTER.NO_KEYS) {
      rows = rows.filter((agent) => {
        const plans = credentialsByAgent.planMap.get(agent.name) ?? 0;
        const keys = credentialsByAgent.keyMap.get(agent.name) ?? 0;
        return plans + keys === 0;
      });
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter((agent) =>
        agent.displayName.toLowerCase().includes(query)
      );
    }

    return rows;
  }, [agents, searchQuery, installFilter, readyFilter, credentialsByAgent]);

  const addButtonLabel = tIntegrations("common:actions.add", {
    defaultValue: "Add",
  });
  const addButton = onAdd ? (
    <Button
      variant="secondary"
      size="default"
      icon={<Plus size={14} />}
      iconOnly
      aria-label={addButtonLabel}
      title={addButtonLabel}
      onClick={onAdd}
    />
  ) : null;

  if (error)
    return (
      <Placeholder
        variant="error"
        onRetry={fetchAgents ? () => fetchAgents() : undefined}
      />
    );

  return (
    <SettingsTable
      hover
      loading={loading}
      selectFilters={cliSelectFilters}
      rows={filtered}
      columns={columns}
      getRowKey={(agent) => agent.name}
      onRowClick={setSingleExpandedAgent}
      expandable={expandable}
      headerHeight="tall"
      className="table-expanded-no-hover table-settings-expanded-compact"
      searchBar={{
        searchValue: searchQuery,
        onSearchChange: setSearchQuery,
        searchPlaceholder: t("cliConfig.searchPlaceholder"),
        allowSearchClear: true,
        rightContent: addButton,
      }}
    />
  );
};

export default CliClientsTable;
