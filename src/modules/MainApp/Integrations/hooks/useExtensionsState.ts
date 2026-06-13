/**
 * Extensions state (Skills, MCPs, Plugins) for the Integrations page.
 * Manages selection, hub browsing, install flows, and all CRUD operations.
 *
 * Wizard open-state (Add MCP, Create Skill, Edit MCP, Edit Skill) is read
 * from the URL (`?wizard=...&id=...`) via
 * {@link useWizardParam} — never from local `useState`. The URL is the
 * single source of truth so deep-links, refresh, the back button, and
 * Spotlight navigation all behave correctly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import type { McpConfigScope } from "@src/api/tauri/rpc/schemas/mcp";
import { WIZARD_IDS } from "@src/config/mainAppPaths";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { createLogger } from "@src/hooks/logger";
import { useWizardParam } from "@src/hooks/navigation";
import { useSkillEditor } from "@src/hooks/skills/useSkillEditor";
import { useSkillsHub } from "@src/hooks/skills/useSkillsHub";
import {
  type McpConfigFile,
  useMcpServers,
} from "@src/modules/MainApp/AgentOrgs/config/mcp/useMcpServers";

import type { McpDetailState } from "../Mcp/types";
import type { SkillEditorState, SkillsHubDetailState } from "../Skills/types";
import type { DetailMode, IntegrationCategory, WizardKind } from "../types";
import {
  assembleMcp,
  assembleSkillEditor,
  assembleSkillsHub,
} from "./extensionStateAssemblers";
import { toggleModelForAccounts } from "./modelToggle";
import { useMcpHandlers } from "./useMcpHandlers";

const log = createLogger("Extensions");

export interface UseExtensionsStateReturn {
  extensionSelectedId: string | null;

  skillsHub: SkillsHubDetailState;
  skillEditor: SkillEditorState;
  mcp: McpDetailState;

  modelsActiveTab: string;
  handleModelsTabChange: (tab: string) => void;
  handleToggleModel: (
    model: string,
    agentType: string,
    enabled: boolean
  ) => Promise<void>;

  handleExtensionSelect: (id: string, mode?: DetailMode) => void;
  deselectExtension: () => void;
  clearExtensionState: (except?: WizardKind) => void;
  triggerMcpAdd: (scope?: McpConfigScope) => void;
  triggerCreateSkill: () => void;
  triggerImportSkill: () => void;
  /** Raw hook returns for tableProps */
  mcpServers: ReturnType<typeof useMcpServers>;
  skillsHubRaw: ReturnType<typeof useSkillsHub>;
}

export function useExtensionsState(
  category: IntegrationCategory,
  setDetailMode: (mode: DetailMode) => void,
  clearRulesMemoryEvolutionState: () => void,
  filteredAccounts: KeyVaultAccount[],
  refreshAccounts: () => Promise<void>,
  initialModelsTab?: string
): UseExtensionsStateReturn {
  const [extensionSelectedId, setExtensionSelectedId] = useState<string | null>(
    null
  );

  const [modelsActiveTab, setModelsActiveTab] = useState(
    initialModelsTab ?? "models"
  );

  // ── Wizard state from URL ──
  const { wizard, entityId, openWizard, closeWizard } = useWizardParam();
  const mcpAddMode =
    wizard === WIZARD_IDS.MCP_ADD || wizard === WIZARD_IDS.MCP_EDIT;
  const [mcpAddScope, setMcpAddScope] = useState<McpConfigScope>("global");
  const mcpEditName = wizard === WIZARD_IDS.MCP_EDIT ? entityId : null;
  const skillEditorMode =
    wizard === WIZARD_IDS.SKILL_CREATE || wizard === WIZARD_IDS.SKILL_EDIT;
  const skillImportMode = wizard === WIZARD_IDS.SKILL_IMPORT;
  // ── Hook calls ──

  const isAddonCategory = category === "externalSkillsets";

  const skillsHubRaw = useSkillsHub({ enabled: isAddonCategory });
  const skillEditorHook = useSkillEditor();
  const mcpServers = useMcpServers({ enabled: isAddonCategory });

  // ── MCP config ──

  const mcpHandlers = useMcpHandlers(mcpServers, setExtensionSelectedId);

  const mcpGetConfig = mcpServers.getConfig;
  const mcpSetConfig = mcpHandlers.setMcpConfig;
  useEffect(() => {
    if (!isAddonCategory) return;
    let cancelled = false;
    mcpGetConfig()
      .then((cfg: McpConfigFile) => {
        if (!cancelled) mcpSetConfig(cfg);
      })
      .catch(log.error);
    return () => {
      cancelled = true;
    };
  }, [mcpGetConfig, mcpSetConfig, category, isAddonCategory]);

  // ── Clear ──
  //
  // With URL-driven wizards, `except` is largely redundant — opening a
  // new wizard via `openWizard(...)` replaces any previous wizard id in
  // the URL automatically. We still honor `except` for in-memory caches
  // that accompany a wizard.

  const clearExtensionState = useCallback(
    (except?: WizardKind) => {
      setExtensionSelectedId(null);

      if (except !== "skill" && except !== "mcp") {
        closeWizard();
      }
      if (except !== "rule") clearRulesMemoryEvolutionState();
    },
    [clearRulesMemoryEvolutionState, closeWizard]
  );

  const deselectExtension = useCallback(() => {
    setExtensionSelectedId(null);
  }, []);

  // ── Selection ──

  const handleExtensionSelect = useCallback(
    (id: string, mode?: DetailMode) => {
      if (!mode && id === extensionSelectedId) {
        deselectExtension();
        setDetailMode("preview");
        return;
      }
      setExtensionSelectedId(id);
      setDetailMode(mode ?? "preview");
      closeWizard();
    },
    [extensionSelectedId, deselectExtension, setDetailMode, closeWizard]
  );

  // ── Skills handlers ──

  const handleUninstallSkill = useCallback(
    async (name: string) => {
      await skillsHubRaw.uninstall(name);
      setExtensionSelectedId(null);
    },
    [skillsHubRaw]
  );

  const handleCreateSkillClick = useCallback(() => {
    setExtensionSelectedId(null);
    skillEditorHook.startCreate();
    openWizard(WIZARD_IDS.SKILL_CREATE);
  }, [skillEditorHook, openWizard]);

  const handleEditSkillClick = useCallback(
    (skillName: string) => {
      const skill = skillsHubRaw.installedSkills.find(
        (sk) => sk.name === skillName
      );
      if (!skill) return;

      skillsHubRaw
        .readSkill(skillName)
        .then(async (content) => {
          await skillEditorHook.startEdit(skill, content);
          setExtensionSelectedId(null);
          openWizard(WIZARD_IDS.SKILL_EDIT, skillName);
        })
        .catch(log.error);
    },
    [skillsHubRaw, skillEditorHook, openWizard]
  );

  const handleSkillEditorBack = useCallback(() => {
    closeWizard();
  }, [closeWizard]);

  const handleSkillEditorSaved = useCallback(async () => {
    closeWizard();
    await skillsHubRaw.refreshInstalled();
  }, [closeWizard, skillsHubRaw]);

  const handleImportSkillClick = useCallback(() => {
    setExtensionSelectedId(null);
    openWizard(WIZARD_IDS.SKILL_IMPORT);
  }, [openWizard]);

  const handleImportSkillCancel = useCallback(() => {
    closeWizard();
  }, [closeWizard]);

  const handleImportSkillRefresh = useCallback(async () => {
    await skillsHubRaw.refreshInstalled();
  }, [skillsHubRaw]);

  // ── MCP handlers ──
  //
  // Edit-mode looks up the server config from the loaded MCP config
  // map by name (the URL only carries the name as `?id=`). When the
  // map hasn't loaded yet `mcpEditConfig` is `undefined` — the wizard
  // host should defer rendering until the lookup resolves.

  const handleMcpAddClick = useCallback(
    (scope: McpConfigScope = "global") => {
      setMcpAddScope(scope);
      setExtensionSelectedId(null);
      openWizard(WIZARD_IDS.MCP_ADD);
    },
    [openWizard]
  );

  const handleMcpAddClose = useCallback(() => {
    closeWizard();
    mcpServers.refresh();
  }, [closeWizard, mcpServers]);

  const handleMcpEdit = useCallback(
    (name: string) => {
      setExtensionSelectedId(null);
      openWizard(WIZARD_IDS.MCP_EDIT, name);
    },
    [openWizard]
  );

  const mcpEditConfig = useMemo(
    () =>
      mcpEditName
        ? (mcpHandlers.mcpConfig.mcpServers[mcpEditName] ?? null)
        : null,
    [mcpEditName, mcpHandlers.mcpConfig]
  );

  const handleModelsTabChange = useCallback((tab: string) => {
    setModelsActiveTab(tab);
  }, []);

  const handleToggleModel = useCallback(
    (model: string, agentType: string, enabled: boolean) =>
      toggleModelForAccounts(
        model,
        agentType,
        enabled,
        filteredAccounts,
        refreshAccounts
      ),
    [filteredAccounts, refreshAccounts]
  );

  // ── Assembled detail-panel props ──

  const skillsHub = useMemo(
    () =>
      assembleSkillsHub({
        skillsHubRaw,
        onUninstallSkill: handleUninstallSkill,
      }),
    [skillsHubRaw, handleUninstallSkill]
  );

  const skillEditorState = useMemo(
    () =>
      assembleSkillEditor({
        editorMode: skillEditorMode,
        editor: skillEditorHook,
        onEditorBack: handleSkillEditorBack,
        onEditorSaved: handleSkillEditorSaved,
        onCreateClick: handleCreateSkillClick,
        onEditClick: handleEditSkillClick,
        importMode: skillImportMode,
        onImportClick: handleImportSkillClick,
        onImportCancel: handleImportSkillCancel,
        onImportRefresh: handleImportSkillRefresh,
      }),
    [
      skillEditorMode,
      skillEditorHook,
      handleSkillEditorBack,
      handleSkillEditorSaved,
      handleCreateSkillClick,
      handleEditSkillClick,
      skillImportMode,
      handleImportSkillClick,
      handleImportSkillCancel,
      handleImportSkillRefresh,
    ]
  );

  const mcpState = useMemo(
    () =>
      assembleMcp({
        addMode: mcpAddMode,
        addScope: mcpAddScope,
        onAddClose: handleMcpAddClose,
        editName: mcpEditName,
        editConfig: mcpEditConfig,
        onSave: mcpHandlers.handleMcpSave,
        mcpServers,
        tools: mcpHandlers.mcpTools,
        toolsLoading: mcpHandlers.mcpToolsLoading,
        resources: mcpHandlers.mcpResources,
        resourcesLoading: mcpHandlers.mcpResourcesLoading,
        onEdit: handleMcpEdit,
        onDelete: mcpHandlers.handleMcpDelete,
        onFetchTools: mcpHandlers.handleMcpFetchTools,
        onFetchResources: mcpHandlers.handleMcpFetchResources,
      }),
    [
      mcpAddMode,
      mcpAddScope,
      handleMcpAddClose,
      mcpEditName,
      mcpEditConfig,
      mcpHandlers,
      mcpServers,
      handleMcpEdit,
    ]
  );

  return {
    extensionSelectedId,
    skillsHub,
    skillEditor: skillEditorState,
    mcp: mcpState,
    modelsActiveTab,
    handleModelsTabChange,
    handleToggleModel,
    handleExtensionSelect,
    deselectExtension,
    clearExtensionState,
    triggerMcpAdd: handleMcpAddClick,
    triggerCreateSkill: handleCreateSkillClick,
    triggerImportSkill: handleImportSkillClick,
    mcpServers,
    skillsHubRaw,
  };
}
