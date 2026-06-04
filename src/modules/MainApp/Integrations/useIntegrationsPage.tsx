import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { ORGII_ORCHESTRATOR } from "@src/assets/providers";
import {
  type ExternalSkillsetsTab,
  buildExternalSkillsetsPath,
  buildIntegrationsPath,
  extensionKindForSkillsetTab,
  parseExternalSkillsetsTab,
  parseIntegrationsPath,
} from "@src/config/mainAppPaths";
import { useServiceAuthState } from "@src/hooks/auth";
import type { DependencyStatus } from "@src/hooks/dependencies";
import { useGitHubConnections } from "@src/hooks/git";
import {
  integrationsAddSignalAtom,
  integrationsToolbarAtom,
} from "@src/store/ui/integrationsToolbarAtom";

import { useOSAgentGateway } from "../AgentOrgs/config/osAgent/useOSAgentGateway";
import { useBuiltInTools } from "./BuiltInTools/useBuiltInTools";
import type { DevToolsTab } from "./DevTools/DevToolsCategoryView";
import { useCliAgents } from "./KeyVault/CliClients/hooks/useCliAgents";
import { useKeyVaultPage } from "./KeyVault/hooks/useKeyVaultPage";
import { useChannelState } from "./hooks/useChannelState";
import { useConnectionsState } from "./hooks/useConnectionsState";
import { useDatabasesState } from "./hooks/useDatabasesState";
import { useExtensionsState } from "./hooks/useExtensionsState";
import { useRoutinesState } from "./hooks/useRoutinesState";
import { useRulesMemoryEvolutionState } from "./hooks/useRulesMemoryEvolutionState";
import { getHasIntegrationsFullPageDetail } from "./integrationsFullPageDetail";
import { VALID_MODELS_TABS } from "./integrationsPageConstants";
import type { AddAction, DetailMode, IntegrationCategory } from "./types";
import { useIntegrationsCategoryTableProps } from "./useIntegrationsCategoryTableProps";
import { useIntegrationsPageDrillDown } from "./useIntegrationsPageDrillDown";

function resolveExternalSkillsetsTab(search: string): ExternalSkillsetsTab {
  return parseExternalSkillsetsTab(search);
}

function navigateToExternalSkillsetsTab(
  navigate: ReturnType<typeof useNavigate>,
  tab: ExternalSkillsetsTab
) {
  navigate(buildExternalSkillsetsPath({ tab }));
}

function categoryFromPath(pathname: string): IntegrationCategory {
  return (parseIntegrationsPath(pathname).category ??
    "models") as IntegrationCategory;
}

export function useIntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const category = useMemo(
    () => categoryFromPath(location.pathname),
    [location.pathname]
  );
  const externalSkillsetsTab = useMemo(
    () => resolveExternalSkillsetsTab(location.search),
    [location.search]
  );

  // Detail-level query params (shareable deep-links).
  const modelsTabParam = searchParams.get("modelsTab");
  const initialModelsTab = useMemo(() => {
    if (!modelsTabParam) return undefined;
    return (VALID_MODELS_TABS as readonly string[]).includes(modelsTabParam)
      ? modelsTabParam
      : undefined;
  }, [modelsTabParam]);

  const devToolsTabParam = searchParams.get("devToolsTab");
  const initialDevToolsTab = devToolsTabParam as DevToolsTab | undefined;

  const navigateToCategory = useCallback(
    (next: IntegrationCategory) => {
      navigate(buildIntegrationsPath({ category: next }));
    },
    [navigate]
  );

  const [detailMode, setDetailMode] = useState<DetailMode>("preview");
  const [devToolsTab, setDevToolsTab] = useState<DevToolsTab | undefined>(
    initialDevToolsTab
  );
  const [databasesActiveTab, setDatabasesActiveTab] = useState("databases");
  const [selectedDbClient, setSelectedDbClient] =
    useState<DependencyStatus | null>(null);
  const [accountListSearch, setAccountListSearch] = useState("");

  const { isAuthenticated } = useServiceAuthState();
  const connectionsActive = category === "connections";
  const gitActive = category === "git";
  const cliAgents = useCliAgents({ enabled: category === "models" });
  const github = useGitHubConnections({
    autoFetch: isAuthenticated && (connectionsActive || gitActive),
  });
  const { gatewayStatus } = useOSAgentGateway(connectionsActive);
  const channelState = useChannelState({
    channelStatuses: gatewayStatus?.channels,
  });
  const accountsHook = useKeyVaultPage();

  const builtInTools = useBuiltInTools();
  const policies = useRulesMemoryEvolutionState(category, setDetailMode);
  const routines = useRoutinesState(category, setDetailMode);
  const extensions = useExtensionsState(
    category,
    setDetailMode,
    policies.clearRulesMemoryEvolutionState,
    accountsHook.filteredAccounts,
    accountsHook.refresh,
    initialModelsTab
  );
  const connections = useConnectionsState(channelState, github, setDetailMode);
  const databasesState = useDatabasesState(category, setDetailMode);

  const handleExternalSkillsetsTabChange = useCallback(
    (tab: ExternalSkillsetsTab) => {
      extensions.deselectExtension();
      setDetailMode("preview");
      navigateToExternalSkillsetsTab(navigate, tab);
    },
    [extensions, navigate]
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional: deps include hook objects whose methods are called
  const handleCategoryChange = useCallback(
    (cat: IntegrationCategory) => {
      if (cat !== category) {
        navigateToCategory(cat);
      }
      extensions.clearExtensionState();
      connections.clearConnectionsState();
      databasesState.clearDatabasesState();
      accountsHook.handleAccountSelect(null);
      routines.clearRoutinesState();
      setSelectedDbClient(null);
      setDevToolsTab(undefined);
      setDetailMode("preview");
    },
    [
      category,
      extensions,
      connections,
      databasesState,
      accountsHook,
      routines,
      navigateToCategory,
    ]
  );

  const handleAccountSelect = useCallback(
    (id: string | null, mode?: DetailMode) => {
      accountsHook.handleAccountSelect(id);
      setDetailMode(mode ?? "preview");
    },
    [accountsHook]
  );

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- intentional: deps include hook objects whose methods are called
  const handleAddAction = useCallback(
    (action: AddAction) => {
      switch (action) {
        case "add-model":
          navigateToCategory("models");
          extensions.clearExtensionState();
          accountsHook.handleAddAccount();
          break;
        case "create-orgii-api-key":
          navigateToCategory("models");
          extensions.clearExtensionState();
          accountsHook.handleAddOrgiiApi();
          break;
        case "add-connection":
          navigateToCategory("connections");
          extensions.clearExtensionState();
          channelState.handleChannelAdd();
          break;
        case "add-database":
          navigateToCategory("databases");
          extensions.clearExtensionState();
          databasesState.handleAddDatabase();
          break;
        case "add-mcp":
          navigateToExternalSkillsetsTab(navigate, "mcp");
          extensions.clearExtensionState("mcp");
          extensions.triggerMcpAdd();
          break;
        case "create-skill":
          navigateToExternalSkillsetsTab(navigate, "skills");
          extensions.clearExtensionState("skill");
          extensions.triggerCreateSkill();
          break;
        case "import-skill":
          navigateToExternalSkillsetsTab(navigate, "skills");
          extensions.clearExtensionState("skill");
          extensions.triggerImportSkill();
          break;
        case "add-rule":
          navigateToCategory("rulesMemoryEvolution");
          extensions.clearExtensionState("rule");
          policies.openNewPolicyWizard();
          break;
        case "add-routine":
          navigateToCategory("routines");
          extensions.clearExtensionState("routine");
          routines.openNewRoutineWizard();
          break;
      }
    },
    [
      extensions,
      accountsHook,
      channelState,
      databasesState,
      policies,
      routines,
      navigate,
      navigateToCategory,
    ]
  );

  // Consume add-action signals dispatched by GlobalToolbar's "+" dropdown.
  // The toolbar writes an AddAction to the dispatch atom; we consume it here
  // where all hooks and useState setters are guaranteed alive (same component).
  // This avoids the stale-callback problem when KeepAlive evicts or deactivates
  // the component — Jotai atoms are lifecycle-independent.
  const [addSignal, setAddSignal] = useAtom(integrationsAddSignalAtom);
  useEffect(() => {
    if (!addSignal) return;
    const { action } = addSignal;
    // Defer so React doesn't flag synchronous setState inside an effect body.
    // The microtask runs before the next paint, so the wizard opens instantly.
    queueMicrotask(() => {
      handleAddAction(action);
      setAddSignal(null);
    });
  }, [addSignal, handleAddAction, setAddSignal]);

  // Register per-category refresh into toolbar registry
  const setToolbarEntry = useSetAtom(integrationsToolbarAtom);
  const refreshGitHubConnections = github.refresh;
  const refreshProjectConnections = channelState.refreshProjectConnections;
  const channelConfigLoaded = channelState.loaded;
  const projectConnectionsLoading = channelState.projectConnectionsLoading;

  const categoryRefresh = useMemo(() => {
    switch (category) {
      case "models":
        return {
          onRefresh: accountsHook.handleRefresh,
          loading: accountsHook.loading,
        };
      case "myRoles":
        return {};
      case "databases":
        return {
          onRefresh: databasesState.refreshDatabases,
          loading: databasesState.loading,
        };
      case "tools":
        return {
          onRefresh: builtInTools.refresh,
          loading: builtInTools.toolsListLoading,
        };
      case "externalSkillsets": {
        const kind = extensionKindForSkillsetTab(externalSkillsetsTab);
        if (kind === "mcp") {
          return {
            onRefresh: extensions.mcpServers.refresh,
            loading: extensions.mcpServers.loading,
          };
        }
        return {
          onRefresh: extensions.skillsHubRaw.refreshInstalled,
          loading: extensions.skillsHubRaw.installedLoading,
        };
      }
      case "connections":
        return {
          onRefresh: async () => {
            await refreshProjectConnections();
          },
          loading: !channelConfigLoaded || projectConnectionsLoading,
        };
      case "git":
        return {
          onRefresh: refreshGitHubConnections,
          loading: github.isLoading,
        };
      case "rulesMemoryEvolution":
        return {
          onRefresh: policies.refreshAll,
          loading: policies.policiesLoading,
        };
      case "routines":
        return {
          onRefresh: routines.refreshRoutines,
          loading: routines.routinesLoading,
        };
      default:
        return {};
    }
  }, [
    category,
    externalSkillsetsTab,
    accountsHook.handleRefresh,
    accountsHook.loading,
    databasesState.refreshDatabases,
    databasesState.loading,
    builtInTools.refresh,
    builtInTools.toolsListLoading,
    extensions.mcpServers.refresh,
    extensions.mcpServers.loading,
    extensions.skillsHubRaw.refreshInstalled,
    extensions.skillsHubRaw.installedLoading,
    refreshGitHubConnections,
    channelConfigLoaded,
    refreshProjectConnections,
    projectConnectionsLoading,
    github.isLoading,
    policies.refreshAll,
    policies.policiesLoading,
    routines.refreshRoutines,
    routines.routinesLoading,
  ]);

  useEffect(() => {
    setToolbarEntry((current) => ({
      ...categoryRefresh,
      extraButtons: current.extraButtons,
    }));
  }, [categoryRefresh, setToolbarEntry]);

  const handleClosePreview = useCallback(() => {
    switch (category) {
      case "models":
        accountsHook.handleAccountSelect("");
        break;
      case "myRoles":
        break;
      case "connections":
      case "git":
        connections.clearConnectionsState();
        break;
      case "databases":
        databasesState.clearDatabasesState();
        break;
      case "tools":
      case "computerUse":
        break;
      case "externalSkillsets":
        extensions.deselectExtension();
        break;
      case "rulesMemoryEvolution":
        policies.clearRulesMemoryEvolutionState();
        break;
      case "routines":
        routines.clearRoutinesState();
        break;
    }
    setDetailMode("preview");
  }, [
    category,
    accountsHook,
    extensions,
    connections,
    databasesState,
    policies,
    routines,
  ]);

  const handleExitFullPage = useCallback(() => setDetailMode("preview"), []);
  const handleEnterFullPage = useCallback(() => setDetailMode("full"), []);

  const handleDatabasesTabChange = useCallback(
    (tab: string) => {
      setDatabasesActiveTab(tab);
      databasesState.handleSelectDatabase(null);
      setSelectedDbClient(null);
    },
    [databasesState]
  );

  const handleModelsTabChange = useCallback(
    (tab: string) => {
      extensions.handleModelsTabChange(tab);
      setSearchParams((currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        if ((VALID_MODELS_TABS as readonly string[]).includes(tab)) {
          nextParams.set("modelsTab", tab);
        } else {
          nextParams.delete("modelsTab");
        }
        return nextParams;
      });
    },
    [extensions, setSearchParams]
  );

  const { tableProps } = useIntegrationsCategoryTableProps({
    category,
    accountsHook,
    handleAccountSelect,
    extensions,
    githubHasConnections: github.hasConnections,
    githubConnections: github.connections,
    githubConnectionsLoading: github.isLoading,
    channelState,
    connections,
    databasesState,
    databasesActiveTab,
    handleDatabasesTabChange,
    selectedDbClient,
    setSelectedDbClient,
    policies,
    routines,
    cliAgents,
    handleAddAction,
    modelsActiveTab: initialModelsTab,
    handleModelsTabChange,
  });

  const { t: tIntegrations } = useTranslation("integrations");

  const hasFullPageDetail = getHasIntegrationsFullPageDetail({
    detailMode,
    category,
    externalSkillsetsTab,
    hasSelectedOrgiiAccount:
      accountsHook.selectedAccount?.modelType === ORGII_ORCHESTRATOR,
    hasSelectedDatabase: !!databasesState.selectedDatabase,
    hasExtensionSelected: !!extensions.extensionSelectedId,
    hasPolicySelection: !!policies.detailState.selectedMarkdownRule,
    hasRoutineSelection: !!routines.routinesState.selectedRoutine,
    hasConnectionSelection:
      category === "git"
        ? !!connections.selectedGitProvider
        : !!connections.selectedIntegrationKind,
  });

  const accountListFiltered = useMemo(() => {
    if (!accountListSearch.trim()) return accountsHook.filteredAccounts;
    const query = accountListSearch.toLowerCase();
    return accountsHook.filteredAccounts.filter((acc) =>
      acc.name.toLowerCase().includes(query)
    );
  }, [accountsHook.filteredAccounts, accountListSearch]);

  const {
    drillDownItems,
    handleDrillDownSelect,
    drillDownSelectedId,
    drillDownAddHandler,
    drillDownTitle,
    drillDownLoading,
  } = useIntegrationsPageDrillDown({
    category,
    externalSkillsetsTab,
    databasesState,
    extensions,
    policies,
    routines,
    connections,
    channelState,
    githubHasConnections: github.hasConnections,
    tIntegrations,
    handleAddAction,
  });

  return {
    hasFullPageDetail,
    listColumnProps: {
      hasFullPageDetail,
      category,
      onViewChange: handleCategoryChange,
      accountsHook,
      accountListFiltered,
      accountListSearch,
      onAccountSelect: handleAccountSelect,
      onSearchChange: setAccountListSearch,
      onExitFullPage: handleExitFullPage,
      drillDownItems,
      drillDownSelectedId,
      drillDownLoading,
      onDrillDownSelect: handleDrillDownSelect,
      drillDownTitle,
      drillDownAddHandler,
    },
    detailPanelProps: {
      category,
      detailMode,
      devToolsTab,
      selectedIntegrationKind: connections.selectedIntegrationKind,
      selectedGitProvider: connections.selectedGitProvider,
      selectedServiceType: connections.selectedServiceType,
      onExitFullPage: handleExitFullPage,
      onEnterFullPage: handleEnterFullPage,
      onClosePreview: handleClosePreview,
      onGitConnected: connections.handleGitConnected,
      channel: channelState,
      accounts: accountsHook,
      extensionSelectedId: extensions.extensionSelectedId,
      builtInTools,
      tableProps,
      skillsHub: extensions.skillsHub,
      skillEditor: extensions.skillEditor,
      mcp: extensions.mcp,
      databasesState: {
        selectedDatabase: databasesState.selectedDatabase,
        probeResult: databasesState.probeResult,
        probing: databasesState.probing,
        addWizardOpen: databasesState.addWizardOpen,
        onProbe: databasesState.handleProbe,
        onRemove: databasesState.handleRemove,
        onCloseAddWizard: databasesState.closeAddWizard,
      },
      policies: {
        ...policies.detailState,
        onClose: handleClosePreview,
      },
      routines: {
        ...routines.routinesState,
        onClose: handleClosePreview,
      },
      externalSkillsetsTab,
      onExternalSkillsetsTabChange: handleExternalSkillsetsTabChange,
    },
  };
}
