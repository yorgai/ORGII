/**
 * useSessionCreatorShell
 *
 * Extracts all state, effects, atoms, handlers, and derived display values
 * from SessionCreatorShell, leaving the component responsible only for JSX.
 */
import { type AgentSelection } from "@/src/scaffold/GlobalSpotlight/palettes";
import type { RepoItem } from "@/src/scaffold/GlobalSpotlight/types";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  CliAgentType,
  ModelType,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE } from "@src/api/tauri/session";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import {
  type UseSessionCreatorOptions,
  useSessionCreator,
} from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionCreator";
import {
  createSystemPathSessionSource,
  getSystemHomeSourceLabel,
  getSystemPathIdFromRepoItem,
  isSystemPathSource,
} from "@src/features/SessionCreator/utils/systemPathSource";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useKeyVault } from "@src/hooks/keyVault";
import {
  getCliCompatibleAccounts,
  isSourceCompatibleWithAgent,
  useAgentCompatibility,
} from "@src/hooks/models/useAgentCompatibility";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";
import {
  SESSION_TARGET_KIND,
  SYSTEM_PATH_ID,
  agentIconIdAtom,
  agentNameAtom,
  cliAgentTypeAtom,
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionCreatorStateAtom,
  sessionSourceAtom,
  sessionTargetKindAtom,
} from "@src/store/session";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import { creatorDefaultModelSelectionAtom } from "@src/store/session/creatorDefaultModelAtom";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { runningLocationAtom } from "@src/store/session/runningLocationAtom";
import { selectedWorktreePathAtom } from "@src/store/session/selectedWorktreePathAtom";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";
import { draftHasContentAtom } from "@src/store/ui/draftAtom";
import type { SlashItem } from "@src/types/extensions";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

export interface UseSessionCreatorShellOptions {
  onSessionStart?: () => void;
  launchMode?: UseSessionCreatorOptions["launchMode"];
  extraSlashItems?: SlashItem[];
  onSlashSelectIntercept?: UseSessionCreatorOptions["onSlashSelectIntercept"];
  initialModel?: RecentModelEntry | null;
  initialExecMode?: AgentExecMode | null;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function useSessionCreatorShell({
  onSessionStart,
  launchMode,
  extraSlashItems,
  onSlashSelectIntercept,
  initialModel,
  initialExecMode,
}: UseSessionCreatorShellOptions) {
  const { t } = useTranslation("sessions");

  // ── Initial pill seeds ────────────────────────────────────────────────────
  const setCreatorDefaultModel = useSetAtom(creatorDefaultModelSelectionAtom);
  const setCreatorDefaultExecMode = useSetAtom(creatorDefaultExecModeAtom);
  const lastSeededModelKeyRef = React.useRef<string | null>(null);
  const lastSeededExecModeRef = React.useRef<AgentExecMode | null>(null);
  useEffect(() => {
    if (!initialModel) return;
    const key = `${initialModel.sourceType}:${initialModel.modelId}:${initialModel.accountId ?? ""}`;
    if (lastSeededModelKeyRef.current === key) return;
    lastSeededModelKeyRef.current = key;
    setCreatorDefaultModel(initialModel);
  }, [initialModel, setCreatorDefaultModel]);
  useEffect(() => {
    if (!initialExecMode) return;
    if (lastSeededExecModeRef.current === initialExecMode) return;
    lastSeededExecModeRef.current = initialExecMode;
    setCreatorDefaultExecMode(initialExecMode);
  }, [initialExecMode, setCreatorDefaultExecMode]);

  // ── Repo/Branch ───────────────────────────────────────────────────────────
  const {
    repos: reposList,
    selectedRepoId,
    selectRepo,
    currentRepo,
    currentBranch,
    loadBranchList,
  } = useRepoSelection({ autoLoad: true });

  // ── Session Creator Hook ──────────────────────────────────────────────────
  const {
    fileInputRef,
    composerInputRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    setAdvancedConfig,
    effectiveSource,
    repos,
    providers,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
    handleContentChange,
    handleAtMention,
    handleAtMentionClose,
    handleAtMentionClick,
    handleAtSelect,
    handleLaunch: originalHandleLaunch,
    handleBranchChange,
    showAddFundsModal,
    closeAddFundsModal,
    showBuyCreditsModal,
    closeBuyCreditsModal,
    pendingBonusInfo,
    acceptBonus,
    declineBonus,
    attachedImages,
    handleImagePaste,
    removeImage,
    canLaunch,
    slashCommandKeyboardHandlerRef,
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredSlashItems,
    slashLoading,
    prefetchSlashItems,
  } = useSessionCreator({
    launchMode,
    extraSlashItems,
    onSlashSelectIntercept,
  });

  // ── Session State Atoms ───────────────────────────────────────────────────
  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentName = useAtomValue(agentNameAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const { registry } = useAgentCompatibility();
  const { accounts: keyVaultAccounts } = useKeyVault({ autoLoad: true });
  const { builtInAgents, agents: customAgents } = useAgentDefinitions();

  const agentVariant = getRustAgentType(selectedAgentDefId);
  const isRustMode = dispatchCategory === "rust_agent";
  const isOSMode = isRustMode && agentVariant === "os";
  const isCliMode = dispatchCategory === "cli_agent";
  const isCursorIdeMode = dispatchCategory === "cursor_ide";

  const runningLocation = useAtomValue(runningLocationAtom);
  const setRunningLocation = useSetAtom(runningLocationAtom);
  const setSelectedWorktreePath = useSetAtom(selectedWorktreePathAtom);

  const handleWorktreeLocationChange = useCallback(
    (location: Parameters<typeof setRunningLocation>[0]) => {
      setSelectedWorktreePath(null);
      setRunningLocation(location);
    },
    [setRunningLocation, setSelectedWorktreePath]
  );

  const setSessionSource = useSetAtom(sessionSourceAtom);
  const [isCategorySelectorOpen, setIsCategorySelectorOpen] = useState(false);
  const [requestModelOpen, setRequestModelOpen] = useState(false);

  // ── Pre-fill editor with restored text ───────────────────────────────────
  const store = useStore();
  const restoreToInput = useAtomValue(restoreToInputAtom);
  const setImageAttachments = useSetAtom(chatImageAttachmentsAtom);
  const [initialRestoreText] = useState<string>(() => {
    return store.get(restoreToInputAtom)?.displayContent ?? "";
  });

  // ── Draft Content Tracking ────────────────────────────────────────────────
  const setDraftHasContent = useSetAtom(draftHasContentAtom);

  const handleContentChangeWithTracking = useCallback(
    (text: string) => {
      setDraftHasContent(text.trim().length > 0);
      handleContentChange?.(text);
    },
    [handleContentChange, setDraftHasContent]
  );

  useEffect(() => {
    if (!restoreToInput?.displayContent) return;
    const editor = composerInputRef.current;
    if (!editor) return;
    const restoredText = restoreToInput.displayContent;
    editor.setContent(restoredText);
    editor.focus();
    handleContentChangeWithTracking(restoredText);
    if (restoreToInput.imageDataUrls?.length) {
      const restoredImages: ChatImageAttachment[] =
        restoreToInput.imageDataUrls.map((dataUrl, idx) => ({
          id: `restored_${Date.now()}_${idx}`,
          dataUrl,
          fileName: `restored-image-${idx + 1}.png`,
          size: 0,
          width: 0,
          height: 0,
        }));
      setImageAttachments((prev) => [
        ...prev.filter((image) => image.ownerId),
        ...restoredImages,
      ]);
    }
    store.set(restoreToInputAtom, null);
    store.set(draftHasContentAtom, restoredText.trim().length > 0);
  }, [
    restoreToInput,
    composerInputRef,
    handleContentChangeWithTracking,
    setImageAttachments,
    store,
  ]);

  useEffect(() => {
    return () => {
      setDraftHasContent(false);
    };
  }, [setDraftHasContent]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleLaunch = useCallback(async () => {
    const launched = await originalHandleLaunch();
    if (launched) {
      onSessionStart?.();
    }
  }, [originalHandleLaunch, onSessionStart]);

  const handleCategorySelect = useCallback(
    (selection: AgentSelection) => {
      setCreatorState((prev) => ({
        ...prev,
        dispatchCategory: selection.category,
        targetKind: selection.targetKind,
        selectedAgentDefinitionId: selection.agentDefinitionId ?? null,
        selectedAgentOrgId: selection.agentOrgId ?? null,
        agentName: selection.agentName,
        agentIconId: selection.agentIconId ?? null,
        cliAgentType: selection.cliAgentType ?? null,
      }));

      const newCliType = selection.cliAgentType;
      const hasModel = Boolean(
        advancedConfig.model || advancedConfig.listingModel
      );
      const hasSource = Boolean(advancedConfig.selectedSourceModelType);
      const isHosted = advancedConfig.keySource === KEY_SOURCE.HOSTED;

      const isSourceCompatible =
        !hasSource ||
        isHosted ||
        !newCliType ||
        isSourceCompatibleWithAgent(
          registry,
          selection.category,
          newCliType,
          advancedConfig.selectedSourceModelType!
        );
      const selectedAccount = advancedConfig.selectedAccountId
        ? keyVaultAccounts.find(
            (account) => account.id === advancedConfig.selectedAccountId
          )
        : undefined;
      const isSelectedAccountCompatible =
        selection.category !== "cli_agent" ||
        !newCliType ||
        !selectedAccount ||
        getCliCompatibleAccounts(registry, newCliType, [selectedAccount])
          .length > 0;

      if (!isSourceCompatible || !isSelectedAccountCompatible) {
        setCreatorDefaultModel(null);
        setAdvancedConfig({
          keySource: advancedConfig.keySource,
          cliAgentType: newCliType as CliAgentType,
        });
        setRequestModelOpen(true);
      } else if (!hasModel || !hasSource) {
        if (newCliType) {
          setAdvancedConfig({ ...advancedConfig, cliAgentType: newCliType });
        }
        setRequestModelOpen(true);
      } else if (newCliType) {
        setAdvancedConfig({ ...advancedConfig, cliAgentType: newCliType });
      }
    },
    [
      setCreatorState,
      setCreatorDefaultModel,
      setAdvancedConfig,
      advancedConfig,
      registry,
      keyVaultAccounts,
    ]
  );

  const handleAdvancedConfigChange = useCallback(
    (config: typeof advancedConfig) => {
      setAdvancedConfig(config);
    },
    [setAdvancedConfig]
  );

  const handleRepoChange = useCallback(
    (repoId: string, options?: { repoKind?: RepoKind }) => {
      selectRepo(repoId);
      const repo = reposList.find((repoItem) => repoItem.id === repoId);
      const isFolder =
        options?.repoKind === REPO_KIND.FOLDER ||
        repo?.kind === REPO_KIND.FOLDER;
      setSessionSource({
        type: "local",
        repoId,
        repoName: repo?.name,
        repoPath: repo?.path || repo?.fs_uri,
        branch: isFolder
          ? undefined
          : (effectiveSource?.branch ?? currentBranch),
      });
    },
    [
      selectRepo,
      reposList,
      currentBranch,
      effectiveSource?.branch,
      setSessionSource,
    ]
  );

  const handleRepoSelectForSession = useCallback(
    (repoId: string, repo: RepoItem) => {
      const systemPathId = getSystemPathIdFromRepoItem(repo);
      if (systemPathId) {
        setSessionSource(createSystemPathSessionSource(systemPathId, t));
        return;
      }

      const isFolder = repo.kind === REPO_KIND.FOLDER;
      setSessionSource({
        type: "local",
        repoId,
        repoName: repo.name,
        repoPath: repo.fs_uri,
        branch: isFolder ? undefined : currentBranch,
      });
    },
    [currentBranch, setSessionSource, t]
  );

  useEffect(() => {
    if (!selectedRepoId) return;
    if (currentRepo?.kind === REPO_KIND.FOLDER) return;
    loadBranchList();
  }, [selectedRepoId, loadBranchList, currentRepo?.kind]);

  // ── Derived display values ────────────────────────────────────────────────
  const isSystemPath = isSystemPathSource(effectiveSource);
  const isSystemHomeSource =
    isSystemPath && effectiveSource?.systemPathId === SYSTEM_PATH_ID.HOME;
  const sessionRepoId = effectiveSource?.repoId ?? "";
  const sessionRepo = useMemo(
    () => repos.find((repoItem) => repoItem.id === sessionRepoId),
    [repos, sessionRepoId]
  );
  const repoDisplayName = isSystemHomeSource
    ? getSystemHomeSourceLabel(t)
    : (effectiveSource?.repoName ?? sessionRepo?.name);
  const effectiveBranchName = isSystemPath
    ? undefined
    : effectiveSource?.branch || "main";
  const sessionRepoKind = isSystemPath
    ? undefined
    : (sessionRepo?.kind ?? currentRepo?.kind);
  const currentRepoPath = isSystemPath ? "" : (effectiveSource?.repoPath ?? "");

  const selectedAgentDefinition = useMemo(
    () =>
      selectedAgentDefId
        ? [...builtInAgents, ...customAgents].find(
            (agent) => agent.id === selectedAgentDefId
          )
        : undefined,
    [builtInAgents, customAgents, selectedAgentDefId]
  );

  useEffect(() => {
    if (!selectedAgentDefId || !selectedAgentDefinition) return;
    setCreatorState((previous) => {
      if (previous.selectedAgentDefinitionId !== selectedAgentDefId) {
        return previous;
      }
      const nextAgentName = selectedAgentDefinition.name;
      const nextAgentIconId = selectedAgentDefinition.iconId ?? null;
      if (
        previous.agentName === nextAgentName &&
        previous.agentIconId === nextAgentIconId
      ) {
        return previous;
      }
      return {
        ...previous,
        agentName: nextAgentName,
        agentIconId: nextAgentIconId,
      };
    });
  }, [selectedAgentDefId, selectedAgentDefinition, setCreatorState]);

  const resolvedAgentName = selectedAgentDefinition?.name ?? agentName;
  const resolvedAgentIconId = selectedAgentDefinition?.iconId || agentIconId;
  const hasAgentSelected = !!(
    (isCliMode && cliAgentType) ||
    (targetKind === SESSION_TARGET_KIND.AGENT_ORG && selectedAgentOrgId) ||
    selectedAgentDefId ||
    resolvedAgentName
  );

  const agentSelectorIcon = useMemo(() => {
    if (isCliMode && cliAgentType)
      return {
        type: "model",
        cliAgentType: cliAgentType as ModelType,
      } as const;
    if (isCursorIdeMode) {
      // External IDE: render the same Cursor brand mark the CLI row
      // uses so the selector pill matches the picker option.
      return {
        type: "model",
        cliAgentType: "cursor_cli" as ModelType,
      } as const;
    }
    if (isRustMode) {
      const iconId = resolvedAgentIconId || "code";
      return { type: "rust", iconId } as const;
    }
    return null;
  }, [
    isRustMode,
    isCliMode,
    isCursorIdeMode,
    cliAgentType,
    resolvedAgentIconId,
  ]);

  const agentSelectorLabel = useMemo(() => {
    if (!hasAgentSelected) return t("creator.selectAgent");
    if (resolvedAgentName) return resolvedAgentName;
    if (isOSMode) return t("creator.osAgent");
    return t("creator.agent");
  }, [hasAgentSelected, resolvedAgentName, isOSMode, t]);

  return {
    t,
    // Editor state
    fileInputRef,
    composerInputRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    initialRestoreText,
    // Context menu
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    // Handlers
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
    handleContentChangeWithTracking,
    handleAtMention,
    handleAtMentionClose,
    handleAtMentionClick,
    handleAtSelect,
    handleLaunch,
    handleBranchChange,
    handleCategorySelect,
    handleAdvancedConfigChange,
    handleRepoChange,
    handleRepoSelectForSession,
    // Modal state — wallet/credit modals live under `.market/`; OSS render
    // sites mount nothing, but the trigger seam flows through unchanged.
    showAddFundsModal,
    closeAddFundsModal,
    showBuyCreditsModal,
    closeBuyCreditsModal,
    pendingBonusInfo,
    acceptBonus,
    declineBonus,
    // Images
    attachedImages,
    handleImagePaste,
    removeImage,
    // Launch
    canLaunch,
    // Slash command
    slashCommandKeyboardHandlerRef,
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredSlashItems,
    slashLoading,
    prefetchSlashItems,
    // Session state
    dispatchCategory,
    selectedAgentDefId,
    selectedAgentOrgId,
    cliAgentType,
    isCategorySelectorOpen,
    setIsCategorySelectorOpen,
    requestModelOpen,
    setRequestModelOpen,
    isOSMode,
    // Repo/branch
    sessionRepoId,
    repoDisplayName,
    currentRepoPath,
    effectiveBranchName,
    sessionRepoKind,
    currentRepo,
    providers,
    // Worktree location
    runningLocation,
    handleWorktreeLocationChange,
    // Agent display
    agentSelectorIcon,
    agentSelectorLabel,
    hasAgentSelected,
    resolvedAgentIconId,
  };
}
