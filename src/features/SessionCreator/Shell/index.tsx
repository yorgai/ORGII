/**
 * SessionCreatorShell
 *
 * The shared SessionCreator base component composed by all variants
 * (`Factory`, `Inbox`, `ChatPanel`, and the embedded layout).
 * It owns the Tiptap editor, slash menu, agent picker, model/mode pills,
 * repo/branch line, and the launch button. Variants wrap this Shell with
 * extra logic (group-chat tagging, reply-mode header overrides, factory
 * styling, etc.) via props like `headerOverride`, `extraSlashItems`, and
 * `onSlashSelectIntercept`.
 *
 * All state/logic lives in useSessionCreatorShell.ts.
 */
import { DispatchCategoryPalette } from "@/src/scaffold/GlobalSpotlight/palettes";
import { X } from "lucide-react";
import React, { Suspense } from "react";

import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";
import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import ModelIcon from "@src/components/ModelIcon";
import SelectorPill from "@src/components/SelectorPill";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { INPUT_AREA } from "@src/config/inputAreaTokens";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import {
  HEADER_BUTTON,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";
import PinnedActionsBar from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar";
import type { UseSessionCreatorOptions } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionCreator";
import {
  SYSTEM_HOME_SOURCE_ID,
  getSystemHomeSourceLabel,
  isSystemPathSourceId,
} from "@src/features/SessionCreator/utils/systemPathSource";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import type { SlashItem } from "@src/types/extensions";

import { EditorArea, SessionInfoLine } from "../components";
import { useSessionCreatorShell } from "./useSessionCreatorShell";

// Lazy-load modals — they're only opened on user action, never on first paint.
// Bundling them eagerly bloats the Shell's critical chunk (and therefore every
// variant that composes it).
const BonusModal = React.lazy(
  () =>
    import(
      /* webpackChunkName: "session-creator-modals" */ "../components/BonusModal"
    )
);

// ============================================
// Types
// ============================================

export interface SessionCreatorShellProps {
  className?: string;
  onSessionStart?: () => void;
  onClose?: () => void;
  launchMode?: UseSessionCreatorOptions["launchMode"];
  launchLabel?: string;
  layout?: "embedded" | "factory" | "inbox";
  /**
   * Synthetic slash items appended to the `/` menu for this variant
   * (forwarded to `useSessionCreator`). Variants pair this with
   * `onSlashSelectIntercept` to handle their commands locally.
   */
  extraSlashItems?: SlashItem[];
  /** See `UseSessionCreatorOptions.onSlashSelectIntercept`. */
  onSlashSelectIntercept?: UseSessionCreatorOptions["onSlashSelectIntercept"];
  /**
   * Optional content rendered above the editor, inside the variant's root
   * stack. The Inbox variant uses this to show the "Reply to …" banner.
   */
  preEditorContent?: React.ReactNode;
  /**
   * When provided, replaces the entire top header row (the row that
   * normally hosts the agent selector + repo/branch info). Used by the
   * Inbox variant's reply mode.
   */
  headerOverride?: React.ReactNode;
  /**
   * One-shot seed for the creator's model pill. Same semantics as
   * `initialModel` — see that prop for details (including the
   * "seed bleeds into global default" trade-off).
   */
  initialModel?: RecentModelEntry | null;
  /**
   * One-shot seed for the creator's exec mode pill.
   */
  initialExecMode?: AgentExecMode | null;
}

// ============================================
// Component
// ============================================

const SessionCreatorShell: React.FC<SessionCreatorShellProps> = ({
  className = "",
  onSessionStart,
  onClose,
  launchMode,
  launchLabel,
  layout = "embedded",
  extraSlashItems,
  onSlashSelectIntercept,
  preEditorContent,
  headerOverride,
  initialModel,
  initialExecMode,
}) => {
  const {
    t,
    fileInputRef,
    tiptapRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    initialRestoreText,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
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
    dispatchCategory,
    selectedAgentDefId,
    selectedAgentOrgId,
    cliAgentType,
    isCategorySelectorOpen,
    setIsCategorySelectorOpen,
    requestModelOpen,
    setRequestModelOpen,
    isOSMode,
    sessionRepoId,
    repoDisplayName,
    currentRepoPath,
    effectiveBranchName,
    sessionRepoKind,
    currentRepo,
    agentSelectorIcon,
    agentSelectorLabel,
    hasAgentSelected,
    runningLocation,
    handleWorktreeLocationChange,
  } = useSessionCreatorShell({
    onSessionStart,
    launchMode,
    extraSlashItems,
    onSlashSelectIntercept,
    initialModel,
    initialExecMode,
  });

  const resolvedAgentSelectorIcon = agentSelectorIcon
    ? agentSelectorIcon.type === "model"
      ? React.createElement(ModelIcon, {
          agentType: agentSelectorIcon.cliAgentType as ModelType,
          size: 14,
        })
      : React.createElement(resolveAgentIcon(agentSelectorIcon.iconId), {
          size: 14,
          strokeWidth: 1.75,
          className: hasAgentSelected ? "text-text-1" : "text-warning-6",
        })
    : null;

  const displayedRepoId =
    isOSMode && !sessionRepoId ? SYSTEM_HOME_SOURCE_ID : sessionRepoId;
  const displayedRepoName =
    isOSMode && !repoDisplayName
      ? getSystemHomeSourceLabel(t)
      : repoDisplayName;
  const isDisplayedSystemPath = isSystemPathSourceId(displayedRepoId);

  const rootClassName =
    layout === "factory"
      ? `composer-breathing flex w-full flex-col ${INPUT_AREA.borderRadiusClass} ${INPUT_AREA.shellInteractionClasses} ${INPUT_AREA.backgroundDefaultClass} ${className}`
      : `flex w-full flex-col gap-2 ${className}`;

  const defaultFactoryHeader = (
    <>
      <SelectorPill
        icon={resolvedAgentSelectorIcon}
        label={agentSelectorLabel}
        active={isCategorySelectorOpen}
        danger={!hasAgentSelected}
        size="md"
        tooltip={t("creator.switchAgent")}
        tooltipPosition="top"
        onClick={() => setIsCategorySelectorOpen(true)}
        ariaLabel={agentSelectorLabel}
        variant="ghost"
      />
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
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
          pillVariant="ghost"
        />
        {onClose && (
          <button
            type="button"
            className={HEADER_BUTTON.action}
            onClick={onClose}
            title={t("tooltips.hidePanel")}
            aria-label={t("tooltips.hidePanel")}
          >
            <X size={HEADER_ICON_SIZE.md} />
          </button>
        )}
      </div>
    </>
  );

  const defaultStandardHeader = (
    <>
      <SelectorPill
        icon={resolvedAgentSelectorIcon}
        label={agentSelectorLabel}
        active={isCategorySelectorOpen}
        danger={!hasAgentSelected}
        size="md"
        tooltip={t("creator.switchAgent")}
        tooltipPosition="top"
        onClick={() => setIsCategorySelectorOpen(true)}
        ariaLabel={agentSelectorLabel}
      />
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
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
        />
      </div>
    </>
  );

  return (
    <div className={rootClassName}>
      {layout === "factory" ? (
        <div className="flex items-center justify-between gap-2 border-b border-border-2 px-2 py-0.5">
          {headerOverride ?? defaultFactoryHeader}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          {headerOverride ?? defaultStandardHeader}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUpload}
        accept="*/*"
      />

      {preEditorContent}

      {/* Editor */}
      <EditorArea
        variant="chatPanel"
        uploadedFiles={uploadedFiles}
        onRemoveFile={handleRemoveFile}
        tiptapRef={tiptapRef as React.RefObject<TiptapInputRef>}
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
        launchLabel={launchLabel}
        shellClassName={
          layout === "factory"
            ? "!border-0 !shadow-none focus-within:!border-transparent focus-within:!shadow-none [&:not(:focus-within):hover]:!border-transparent [&:not(:focus-within):hover]:!shadow-none"
            : undefined
        }
        editorMinHeight={layout === "factory" ? 150 : undefined}
        editorMaxHeight={layout === "factory" ? 260 : undefined}
        onRemoveImage={removeImage}
        launchDisabled={!canLaunch}
        requestModelOpen={requestModelOpen}
        onModelOpenHandled={() => setRequestModelOpen(false)}
        initialContent={initialRestoreText || undefined}
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
        onPrefetchSlashItems={prefetchSlashItems}
      />

      <PinnedActionsBar
        tiptapRef={tiptapRef as React.RefObject<TiptapInputRef>}
      />

      {/* Agent Selector Modal */}
      <DispatchCategoryPalette
        isOpen={isCategorySelectorOpen}
        onClose={() => setIsCategorySelectorOpen(false)}
        onSelect={handleCategorySelect}
        currentCategory={dispatchCategory}
        currentAgentDefinitionId={selectedAgentDefId ?? undefined}
        currentAgentOrgId={selectedAgentOrgId ?? undefined}
        currentCliAgentType={cliAgentType ?? undefined}
      />

      {/*
        OSS build: AddFundsModal / BuyCreditsModal live under `.market/`
        and are not mounted here. Hosted-key wallet errors surface as a
        toast from useSessionLaunch. Commercial build re-imports the
        modals from un-archived `.market/` and renders them gated on
        showAddFundsModal / showBuyCreditsModal from useSessionCreator.
      */}

      {pendingBonusInfo && (
        <Suspense fallback={null}>
          <BonusModal
            bonusInfo={pendingBonusInfo}
            onAccept={acceptBonus}
            onDecline={declineBonus}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SessionCreatorShell;
