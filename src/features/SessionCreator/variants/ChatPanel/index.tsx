import {
  DispatchCategoryDropdown,
  DispatchCategoryPalette,
} from "@/src/scaffold/GlobalSpotlight/palettes";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Airplay, Network, Paperclip, Tags } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";
import Button from "@src/components/Button";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import ModelIcon from "@src/components/ModelIcon";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import { isRegionSanctioned } from "@src/config/providerRegions";
import PinnedActionsBar from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar";
import type { ChatPanelRegionNotice } from "@src/engines/ChatPanel/types";
import { useSessionCreator } from "@src/engines/SessionCore/hooks/session/useSessionCreator";
import type {
  SessionLaunchSuccessInfo,
  SessionLaunchWorkItemContext,
} from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import type { SessionCreatorLaunchMode } from "@src/features/SessionCreator/types";
import {
  SYSTEM_HOME_SOURCE_ID,
  getSystemHomeSourceLabel,
  isSystemPathSourceId,
} from "@src/features/SessionCreator/utils/systemPathSource";
import { useRegionCheck } from "@src/hooks/config";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useAgentCompatibility } from "@src/hooks/models/useAgentCompatibility";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import { useCliAgents } from "@src/modules/MainApp/Integrations/KeyVault/CliClients/hooks/useCliAgents";
import { PresenceMenuButton } from "@src/scaffold/NavigationSidebar/blocks/SidebarBottomBar";
import { REPO_KIND } from "@src/store/repo/types";
import {
  SESSION_TARGET_KIND,
  agentIconIdAtom,
  agentNameAtom,
  cliAgentTypeAtom,
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
  selectedAgentOrgIdAtom,
  sessionCreatorStateAtom,
  sessionTargetKindAtom,
} from "@src/store/session";
import { restoreToInputAtom } from "@src/store/session/cliSessionStatusAtom";
import { runningLocationAtom } from "@src/store/session/runningLocationAtom";
import { selectedWorktreePathAtom } from "@src/store/session/selectedWorktreePathAtom";
import {
  type ChatImageAttachment,
  chatImageAttachmentsAtom,
} from "@src/store/ui/chatImageAtom";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanelAtom";
import { draftHasContentAtom } from "@src/store/ui/draftAtom";
import { getBigThreeRegionModelTypeForSession } from "@src/util/session/regionAlertModel";
import {
  BUILTIN_GUI_CONTROL_DEF_ID,
  getRustAgentType,
} from "@src/util/session/sessionDispatch";

import { EditorArea, SessionInfoLine } from "../../components";
import BonusModal from "../../components/BonusModal";
import AttachmentPanel from "./AttachmentPopover";
import ScreenPickerModal from "./ScreenPickerModal";
import SessionCreatorAgentHero from "./SessionCreatorAgentHero";
import SessionCreatorOrgMembersPanel from "./SessionCreatorOrgMembersPanel";
import TagPanel from "./TagPanel";
import "./index.scss";
import { resolveSessionCreatorAgentHeroContent } from "./resolveSessionCreatorAgentHero";
import { useSessionCreatorChatPanelHandlers } from "./useSessionCreatorChatPanelHandlers";

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionCreatorChatPanelVariant = "default" | "fullScreen";

export interface SessionCreatorChatPanelProps {
  centerFullScreenContent?: boolean;
  className?: string;
  footerSlot?: React.ReactNode;
  leadingActionSlot?: React.ReactNode;
  hideRepoLine?: boolean;
  initialContent?: string;
  onRegionNoticeChange?: (notice: ChatPanelRegionNotice | null) => void;
  onSessionStart?: (info: SessionLaunchSuccessInfo) => void;
  variant?: SessionCreatorChatPanelVariant;
  workItemContext?: SessionLaunchWorkItemContext;
  resolveWorkItemContext?: () => Promise<SessionLaunchWorkItemContext | null>;
}

interface SessionCreatorChatPanelSingleProps extends SessionCreatorChatPanelProps {
  hidePresenceButton?: boolean;
  launchMode?: SessionCreatorLaunchMode;
}

// ── Component ─────────────────────────────────────────────────────────────────

const SessionCreatorChatPanelSingle: React.FC<
  SessionCreatorChatPanelSingleProps
> = ({
  centerFullScreenContent = false,
  className = "",
  footerSlot,
  leadingActionSlot,
  hideRepoLine = false,
  initialContent,
  onRegionNoticeChange,
  onSessionStart,
  hidePresenceButton = false,
  launchMode,
  variant = "default",
  workItemContext,
  resolveWorkItemContext,
}) => {
  const { t } = useTranslation("sessions");
  const { registry } = useAgentCompatibility();
  const { orgs } = useAgentOrgs();
  const { agents: cliAgentList } = useCliAgents({ enabled: true });

  const {
    repos: reposList,
    selectedRepoId,
    selectRepo,
    currentRepo,
    currentBranch,
    loadBranchList,
  } = useRepoSelection({ autoLoad: true });

  const {
    fileInputRef,
    composerInputRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    setAdvancedConfig,
    effectiveSource,
    repos,
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
  } = useSessionCreator({
    initialContent,
    launchMode,
    persistDraft: !initialContent,
    skipDraftLoading: Boolean(initialContent),
    workItemContext,
    resolveWorkItemContext,
    onLaunchSuccess: onSessionStart,
  });

  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const targetKind = useAtomValue(sessionTargetKindAtom);
  const selectedAgentDefId = useAtomValue(selectedAgentDefinitionIdAtom);
  const selectedAgentOrgId = useAtomValue(selectedAgentOrgIdAtom);
  const agentName = useAtomValue(agentNameAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const { builtInAgents, agents: customAgents } = useAgentDefinitions();

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

  const agentVariant = getRustAgentType(selectedAgentDefId);
  const isRustMode = dispatchCategory === "rust_agent";
  const isOSMode = isRustMode && agentVariant === "os";
  const isWingmanMode = isRustMode && agentVariant === "wingman";
  const isCliMode = dispatchCategory === "cli_agent";
  const isCursorIdeMode = dispatchCategory === "cursor_ide";

  const [isCategorySelectorOpen, setIsCategorySelectorOpen] = useState(false);
  const agentHeroRef = useRef<HTMLButtonElement>(null);
  const [isAttachmentPanelOpen, setIsAttachmentPanelOpen] = useState(false);
  const handleToggleAttachment = useCallback(() => {
    setIsAttachmentPanelOpen((prev) => !prev);
  }, []);
  const [isTagPanelOpen, setIsTagPanelOpen] = useState(false);
  const handleToggleTag = useCallback(() => {
    setIsTagPanelOpen((prev) => !prev);
  }, []);
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
  const [openOrgMembersPanelId, setOpenOrgMembersPanelId] = useState<
    string | null
  >(null);
  const isOrgMembersPanelOpen =
    targetKind === SESSION_TARGET_KIND.AGENT_ORG &&
    Boolean(selectedAgentOrgId) &&
    openOrgMembersPanelId === selectedAgentOrgId;

  // ── Handlers via extracted hook ───────────────────────────────────────────

  const {
    screenPickerMonitors,
    setScreenPickerMonitors,
    handleShareScreenClick,
    handleScreenPicked,
    preloadWingmanWindows,
    handleRepoChange,
    handleRepoSelectForSession,
    requestModelOpen,
    setRequestModelOpen,
    handleCategorySelect,
  } = useSessionCreatorChatPanelHandlers({
    reposList,
    currentBranch,
    effectiveSource,
    advancedConfig,
    setAdvancedConfig,
    selectRepo,
  });

  const handleAdvancedConfigChange = useCallback(
    (config: typeof advancedConfig) => {
      setAdvancedConfig(config);
    },
    [setAdvancedConfig]
  );

  // ── Restore text ──────────────────────────────────────────────────────────

  const store = useStore();
  const restoreToInput = useAtomValue(restoreToInputAtom);
  const setImageAttachments = useSetAtom(chatImageAttachmentsAtom);
  const [initialRestoreText] = useState<string>(() => {
    return store.get(restoreToInputAtom)?.displayContent ?? "";
  });

  // ── Draft content tracking ────────────────────────────────────────────────

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

  // ── Launch ────────────────────────────────────────────────────────────────

  const handleLaunch = useCallback(async () => {
    return originalHandleLaunch();
  }, [originalHandleLaunch]);

  useEffect(() => {
    if (!selectedRepoId) return;
    if (currentRepo?.kind === REPO_KIND.FOLDER) return;
    loadBranchList();
  }, [selectedRepoId, loadBranchList, currentRepo?.kind]);

  // ── Hero section ──────────────────────────────────────────────────────────

  const sessionRepoId = effectiveSource?.repoId ?? "";
  const sessionRepo = useMemo(
    () => repos.find((repoItem) => repoItem.id === sessionRepoId),
    [repos, sessionRepoId]
  );
  const repoDisplayName = effectiveSource?.repoName ?? sessionRepo?.name;
  const effectiveBranchName = effectiveSource?.branch || "main";
  const sessionRepoKind = sessionRepo?.kind ?? currentRepo?.kind;
  const currentRepoPath = effectiveSource?.repoPath ?? "";

  const allAgentDefinitions = useMemo(
    () => [
      ...builtInAgents.filter(
        (agent) => agent.id !== BUILTIN_GUI_CONTROL_DEF_ID
      ),
      ...customAgents,
    ],
    [builtInAgents, customAgents]
  );

  const selectedAgentDefinition = useMemo(
    () =>
      selectedAgentDefId
        ? allAgentDefinitions.find((agent) => agent.id === selectedAgentDefId)
        : undefined,
    [allAgentDefinitions, selectedAgentDefId]
  );

  const selectedOrg = useMemo(
    () =>
      targetKind === SESSION_TARGET_KIND.AGENT_ORG && selectedAgentOrgId
        ? orgs.find((org) => org.id === selectedAgentOrgId)
        : undefined,
    [targetKind, selectedAgentOrgId, orgs]
  );

  // Workstation hides this creator while a session is active
  // (`jumpToSession(sessionId)`) and remounts it when the user returns
  // to a blank creator tab (`jumpToSession(null)`). Rehydrate the
  // selected agent display fields from Rust definitions so the hero
  // icon/name survive that lifecycle even if the persisted creator
  // state only kept `selectedAgentDefinitionId`.
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

  const createAgentSelectorIcon = useCallback(
    (size: number) => {
      if (isCliMode && cliAgentType) {
        return <ModelIcon agentType={cliAgentType as ModelType} size={size} />;
      }
      if (isCursorIdeMode) {
        return <ModelIcon agentType="cursor_cli" size={size} />;
      }
      if (isRustMode) {
        const iconId = resolvedAgentIconId || "code";
        return React.createElement(resolveAgentIcon(iconId), {
          size,
          strokeWidth: 1.75,
          className: hasAgentSelected ? "text-text-1" : "text-primary-6",
        });
      }
      return null;
    },
    [
      isRustMode,
      isCliMode,
      isCursorIdeMode,
      cliAgentType,
      resolvedAgentIconId,
      hasAgentSelected,
    ]
  );

  const heroIcon = useMemo(
    () => createAgentSelectorIcon(20),
    [createAgentSelectorIcon]
  );

  const heroContent = useMemo(
    () =>
      resolveSessionCreatorAgentHeroContent({
        hasAgentSelected,
        dispatchCategory,
        targetKind,
        selectedAgentDefinition,
        resolvedAgentName,
        cliAgentType,
        selectedAgentOrgId,
        orgs,
        agentRegistry: registry,
        isOSMode,
      }),
    [
      hasAgentSelected,
      dispatchCategory,
      targetKind,
      selectedAgentDefinition,
      resolvedAgentName,
      cliAgentType,
      selectedAgentOrgId,
      orgs,
      registry,
      isOSMode,
    ]
  );

  const regionModelType = useMemo(
    () =>
      getBigThreeRegionModelTypeForSession(
        dispatchCategory,
        advancedConfig,
        cliAgentType
      ),
    [dispatchCategory, advancedConfig, cliAgentType]
  );

  const regionCheck = useRegionCheck(regionModelType);
  const regionNotice = useMemo<ChatPanelRegionNotice | null>(() => {
    if (regionModelType === "" || regionCheck.status === "loading") {
      return null;
    }

    const sanctioned =
      regionCheck.countryCode && isRegionSanctioned(regionCheck.countryCode);
    const providerRestricted = regionCheck.status === "unsupported";
    if (!providerRestricted && !sanctioned) {
      return null;
    }

    const location = regionCheck.locationText || regionCheck.countryCode || "";
    const body = providerRestricted
      ? sanctioned
        ? t("creator.regionNoticeBodyBoth", { location })
        : t("creator.regionNoticeBodyProvider", { location })
      : t("creator.regionNoticeBodySanctions", { location });

    return {
      key: `${regionModelType}:${regionCheck.countryCode ?? "unknown"}:${regionCheck.status}`,
      title: t("creator.regionNoticeTitle"),
      body,
    };
  }, [
    regionModelType,
    regionCheck.status,
    regionCheck.countryCode,
    regionCheck.locationText,
    t,
  ]);

  useEffect(() => {
    onRegionNoticeChange?.(regionNotice);
    return () => onRegionNoticeChange?.(null);
  }, [onRegionNoticeChange, regionNotice]);

  const isFullScreenVariant = variant === "fullScreen";

  const handleToggleOrgMembers = useCallback(() => {
    setOpenOrgMembersPanelId((currentId) =>
      currentId === selectedAgentOrgId ? null : (selectedAgentOrgId ?? null)
    );
  }, [selectedAgentOrgId]);

  const displayedRepoId =
    isOSMode && !sessionRepoId ? SYSTEM_HOME_SOURCE_ID : sessionRepoId;
  const displayedRepoName =
    isOSMode && !repoDisplayName
      ? getSystemHomeSourceLabel(t)
      : repoDisplayName;
  const isDisplayedSystemPath = isSystemPathSourceId(displayedRepoId);

  const repoPills = (
    <div className="flex w-full justify-center">
      <div
        className={`flex w-full flex-wrap items-center justify-start gap-0.5 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
      >
        <SessionInfoLine
          repoId={displayedRepoId}
          repoName={displayedRepoName}
          repoPath={currentRepoPath}
          onRepoChange={handleRepoChange}
          onRepoSelect={handleRepoSelectForSession}
          repoKind={sessionRepoKind}
          includeSystemPaths={isOSMode}
          branchName={
            isOSMode && !sessionRepoId ? undefined : effectiveBranchName
          }
          onBranchChange={handleBranchChange}
          worktreeLocation={isDisplayedSystemPath ? undefined : runningLocation}
          onWorktreeLocationChange={handleWorktreeLocationChange}
          fullWidth
        />
      </div>
    </div>
  );

  const editorArea = (
    <div className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}>
      <EditorArea
        variant="chatPanelFullScreen"
        uploadedFiles={uploadedFiles}
        onRemoveFile={handleRemoveFile}
        composerInputRef={composerInputRef as React.RefObject<ComposerInputRef>}
        onContentChange={handleContentChangeWithTracking}
        onAtMention={handleAtMention}
        onAtMentionClose={handleAtMentionClose}
        onSubmit={handleLaunch}
        showContextMenu={showContextMenu}
        setShowContextMenu={setShowContextMenu}
        atSearchQuery={atSearchQuery}
        setAtSearchQuery={setAtSearchQuery}
        onAtSelect={handleAtSelect}
        repoPath={currentRepoPath}
        onAtMentionClick={handleAtMentionClick}
        onUploadClick={handleUploadClick}
        isLoading={isLoading}
        onLaunch={handleLaunch}
        advancedConfig={advancedConfig}
        onAdvancedConfigChange={handleAdvancedConfigChange}
        hideInfoLine={true}
        repoId={displayedRepoId}
        repoName={displayedRepoName}
        repoKind={isOSMode && !sessionRepoId ? undefined : currentRepo?.kind}
        branchName={
          isOSMode && !sessionRepoId ? undefined : effectiveBranchName
        }
        onBranchChange={handleBranchChange}
        onImagePaste={handleImagePaste}
        attachedImages={attachedImages}
        onRemoveImage={removeImage}
        launchDisabled={!canLaunch}
        requestModelOpen={requestModelOpen}
        onModelOpenHandled={() => setRequestModelOpen(false)}
        shellClassName="session-creator-chat-panel-fullscreen-input-shell"
        initialContent={initialRestoreText || initialContent || undefined}
        autoFocus
        showSlashMenu={showSlashMenu}
        slashQuery={slashQuery}
        slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
        onSlashCommand={handleSlashCommand}
        onSlashCommandClose={handleSlashCommandClose}
        onSlashSelect={handleSlashSelect}
        onModeSelect={handleModeSelect}
        currentMode={currentMode}
        filteredSlashItems={filteredSlashItems}
        slashLoading={slashLoading}
      />
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`session-creator-chat-panel-wrapper ${className}`}
      data-testid="session-creator-chat-panel"
    >
      <div
        className={`flex min-h-0 flex-1 items-center justify-center px-4 ${
          isFullScreenVariant
            ? centerFullScreenContent
              ? "pb-[10vh]"
              : "pb-[18vh]"
            : "pb-[4vh]"
        }`}
      >
        <div
          className={`flex w-full flex-col items-stretch gap-3 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
        >
          <SessionCreatorAgentHero
            ref={agentHeroRef}
            name={heroContent.name}
            description={heroContent.description}
            avatarIcon={heroIcon}
            active={isCategorySelectorOpen}
            danger={heroContent.danger}
            onClick={() => setIsCategorySelectorOpen(true)}
          />

          {isWingmanMode && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-dashed border-border-2 px-3 py-1.5 text-[12px] text-text-3 transition-colors hover:border-primary-4 hover:text-primary-6"
              onMouseEnter={preloadWingmanWindows}
              onFocus={preloadWingmanWindows}
              onClick={() => {
                handleShareScreenClick().catch(console.error);
              }}
            >
              <Airplay size={13} strokeWidth={1.75} />
              {t("chat.shareScreen")}
            </button>
          )}

          <div className="session-creator-chat-panel-fullscreen-composer w-full">
            {editorArea}
            {!hideRepoLine && (
              <div className="session-creator-chat-panel-fullscreen-repo-row px-1 pb-2 pt-3">
                {repoPills}
              </div>
            )}
          </div>

          <div
            className={`mx-auto flex w-full items-center ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
          >
            {leadingActionSlot}
            <Button
              variant="secondary"
              appearance="outline"
              size="small"
              shape="round"
              iconOnly
              icon={<Paperclip size={14} strokeWidth={1.75} />}
              title={t("common:actions.upload")}
              aria-label={t("common:actions.upload")}
              aria-expanded={isAttachmentPanelOpen}
              aria-controls="session-creator-attachment-panel"
              onClick={handleToggleAttachment}
              className={
                isAttachmentPanelOpen
                  ? "shrink-0 !bg-fill-1 !text-primary-6"
                  : "shrink-0"
              }
            />
            <Button
              variant="secondary"
              appearance="outline"
              size="small"
              shape="round"
              iconOnly
              icon={<Tags size={14} strokeWidth={1.75} />}
              title="Add tag"
              aria-label="Add tag"
              aria-expanded={isTagPanelOpen}
              aria-controls="session-creator-tag-panel"
              onClick={handleToggleTag}
              className={
                isTagPanelOpen
                  ? "ml-1 shrink-0 !bg-fill-1 !text-primary-6"
                  : "ml-1 shrink-0"
              }
            />
            {selectedOrg && (
              <Button
                variant="secondary"
                appearance="outline"
                size="small"
                shape="round"
                icon={<Network size={14} strokeWidth={1.75} />}
                title={t("creator.orgMembers.configButton")}
                aria-label={t("creator.orgMembers.configButton")}
                aria-expanded={isOrgMembersPanelOpen}
                aria-controls="session-creator-org-members-panel"
                onClick={handleToggleOrgMembers}
                className={
                  isOrgMembersPanelOpen
                    ? "ml-1 shrink-0 !bg-fill-1 !text-primary-6"
                    : "ml-1 shrink-0"
                }
                data-testid="session-creator-org-members-toggle"
              >
                {t("creator.orgMembers.configButton")}
              </Button>
            )}
            <span aria-hidden className="mx-2 h-4 w-px shrink-0 bg-border-2" />
            <div className="min-w-0 flex-1">
              <PinnedActionsBar
                composerInputRef={
                  composerInputRef as React.RefObject<ComposerInputRef>
                }
              />
            </div>
          </div>

          {isAttachmentPanelOpen && (
            <div
              className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
            >
              <AttachmentPanel open={isAttachmentPanelOpen} />
            </div>
          )}

          {isTagPanelOpen && (
            <div
              className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
            >
              <TagPanel open={isTagPanelOpen} />
            </div>
          )}

          {selectedOrg && isOrgMembersPanelOpen && (
            <div id="session-creator-org-members-panel">
              <SessionCreatorOrgMembersPanel
                org={selectedOrg}
                advancedConfig={advancedConfig}
                onAdvancedConfigChange={handleAdvancedConfigChange}
                allAgents={allAgentDefinitions}
                cliAgents={cliAgentList}
              />
            </div>
          )}

          {!hidePresenceButton && (
            <div className="flex w-full items-center justify-center gap-2 pt-1">
              <PresenceMenuButton
                variant="detailed"
                dropdownPosition="bottom-start"
              />
            </div>
          )}

          {footerSlot}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-file-upload-input"
        onChange={handleFileUpload}
        accept="*/*"
      />

      {modelPickerStyle === "dropdown" ? (
        <DispatchCategoryDropdown
          isOpen={isCategorySelectorOpen}
          onClose={() => setIsCategorySelectorOpen(false)}
          onSelect={handleCategorySelect}
          currentCategory={dispatchCategory}
          currentAgentDefinitionId={selectedAgentDefId ?? undefined}
          currentAgentOrgId={selectedAgentOrgId ?? undefined}
          currentCliAgentType={cliAgentType ?? undefined}
          anchorRef={agentHeroRef}
        />
      ) : (
        <DispatchCategoryPalette
          isOpen={isCategorySelectorOpen}
          onClose={() => setIsCategorySelectorOpen(false)}
          onSelect={handleCategorySelect}
          currentCategory={dispatchCategory}
          currentAgentDefinitionId={selectedAgentDefId ?? undefined}
          currentAgentOrgId={selectedAgentOrgId ?? undefined}
          currentCliAgentType={cliAgentType ?? undefined}
        />
      )}

      {pendingBonusInfo && (
        <BonusModal
          bonusInfo={pendingBonusInfo}
          onAccept={acceptBonus}
          onDecline={declineBonus}
        />
      )}

      {screenPickerMonitors && (
        <ScreenPickerModal
          monitors={screenPickerMonitors}
          onSelect={handleScreenPicked}
          onClose={() => setScreenPickerMonitors(null)}
        />
      )}
    </div>
  );
};

SessionCreatorChatPanelSingle.displayName = "SessionCreatorChatPanelSingle";

export default SessionCreatorChatPanelSingle;
