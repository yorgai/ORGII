/**
 * InputArea Component
 *
 * Main input area for chat with support for:
 * - Text input with @ mentions
 * - File/context attachments
 * - Cite code from editor
 * - Drag-drop file upload
 * - Edit mode for editing existing messages
 *
 * Business logic is split across extracted hooks:
 * - useEditMode: edit mode lifecycle
 * - useContainerDrag: internal file-tree drag interception
 * - useEditorExpansion: compact pill ↔ expanded box layout toggle
 */
import { useAtomValue } from "jotai";
import { RotateCcw, X } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ComposerBar from "@src/components/ComposerBar";
import ComposerShell from "@src/components/ComposerShell";
import { hasNonEmptyTerminalBuffer } from "@src/components/TerminalInteractive/bufferCache";
import { ChatStatusSegmentedBar } from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { useInputArea } from "@src/engines/ChatPanel/hooks/useInputArea";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { useSessionDiscovery } from "@src/engines/SessionCore";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
import type { MenuItemId } from "@src/scaffold/ContextMenu/config";
import {
  type WorkStationTab,
  mainPaneTabsAtom,
} from "@src/store/workstation/tabs";
import { isCursorIdeSession } from "@src/util/session/sessionDispatch";

import ChatHeader from "./ChatHeader";
import CiteCodePreview from "./components/CiteCodePreview";
import ContextMenuPortal from "./components/ContextMenuPortal";
import CursorModePill from "./components/CursorModePill";
import CursorModelPill from "./components/CursorModelPill";
import EditModeHeader from "./components/EditModeHeader";
import EditModeImageThumbnail from "./components/EditModeImageThumbnail";
import ImageAttachmentPreview from "./components/ImageAttachmentPreview";
import InputActions from "./components/InputActions";
import InputEditor from "./components/InputEditor";
import ModePill from "./components/ModePill";
import ModelPill from "./components/ModelPill";
import PinnedActionsBar from "./components/PinnedActionsBar";
import ReplyInfoDisplay from "./components/ReplyInfoDisplay";
import SlashCommandPortal from "./components/SlashCommandPortal";
import { useContainerDrag } from "./hooks/useContainerDrag";
import { useEditMode } from "./hooks/useEditMode";
import { useEditorExpansion } from "./hooks/useEditorExpansion";

/** Normal chat shell top/bottom; expanded “breathing room” is inside the block so the toolbar doesn’t jump vs pill. */

// ============================================
// Type Definitions
// ============================================

interface InputAreaProps {
  /** Custom placeholder text */
  placeholder?: string;
  /** Edit mode - for editing existing messages */
  isEditMode?: boolean;
  /** Initial content for edit mode */
  initialContent?: string;
  /** Callback when edit is submitted */
  onEditSubmit?: (text: string, imageDataUrls?: string[]) => void;
  /** Callback when edit is submitted and immediately sent */
  onEditSendNow?: (text: string, imageDataUrls?: string[]) => void;
  /** Callback when edit is cancelled */
  onEditCancel?: () => void;
  /** Label shown in the edit-mode header bar (e.g. "Editing queued message") */
  editLabel?: string;
  /** Show Cancel/Save buttons in the edit header (default true). Set false for label-only. */
  editHeaderActions?: boolean;
  /** Show the built-in edit header inside the composer shell. */
  showEditHeader?: boolean;
  /** Single-layer history-message edit style; queued edits keep the default action card. */
  quietEditSurface?: boolean;
  /** Read-only images to display in edit mode (from the original message) */
  editImages?: string[];
  /** Use the default surface background variant. */
  surfaceBg?: boolean;
  /** Hide the step/feedback header row (e.g. docked simulator input with external chrome) */
  omitChatHeader?: boolean;
  /** Dock side for the containing chat panel, used to place side previews inward. */
  chatPanelPosition?: "left" | "right";
  /** Explicit session ID for this composer surface. */
  sessionId?: string;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
  customMentionOptions?: ReadonlyArray<CustomMentionOption>;
  /** Pinned status/action pills shown above status banners and composer. */
  topRowPills?: React.ReactNode;
  /** Status banners that should sit below the top pill row and above composer. */
  statusBanners?: React.ReactNode;
  composerShellRef?: React.Ref<HTMLDivElement>;
  /** Keep empty-input group-chat composers send-only even while a run is active. */
  disableStopWhenEmpty?: boolean;
}

const getStringData = (
  tab: WorkStationTab,
  key: string
): string | undefined => {
  const value = tab.data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const getOpenedTabMentionOption = (
  tab: WorkStationTab
): CustomMentionOption | null => {
  const baseOption = (
    selectType: MenuItemId,
    selectValue: string,
    description: string,
    selectDisplayName: string = tab.title
  ): CustomMentionOption => ({
    id: `workstation-tab:${tab.id}`,
    label: tab.title,
    description,
    selectType,
    selectValue,
    selectDisplayName,
  });

  if (tab.type === "file" || tab.type === "git-diff") {
    const filePath = getStringData(tab, "filePath");
    if (!filePath) return null;
    return baseOption("files", filePath, filePath);
  }

  if (tab.type === "directory") {
    const directoryPath = getStringData(tab, "directoryPath");
    if (!directoryPath) return null;
    return baseOption("folder", directoryPath, directoryPath);
  }

  if (tab.type === "terminal") {
    const sessionId = getStringData(tab, "sessionId");
    if (!sessionId || !hasNonEmptyTerminalBuffer(sessionId)) return null;
    return baseOption("terminal", sessionId, "Terminal");
  }

  if (tab.type === "browser-session") {
    const sessionId = getStringData(tab, "sessionId");
    if (!sessionId) return null;
    return baseOption(
      "browser",
      sessionId,
      getStringData(tab, "url") ?? "Browser"
    );
  }

  if (tab.type === "chat-session") {
    const sessionId = getStringData(tab, "sessionId");
    if (!sessionId) return null;
    return baseOption("session", sessionId, "Session");
  }

  if (tab.type === "project-workitems") {
    const projectSlug = getStringData(tab, "projectSlug");
    if (!projectSlug) return null;
    return baseOption("project", projectSlug, "Work items");
  }

  if (tab.type === "workItem-detail") {
    const workItemId = getStringData(tab, "workItemId");
    if (!workItemId) return null;
    return baseOption(
      "workitem",
      workItemId,
      getStringData(tab, "projectName") ?? "Work item",
      getStringData(tab, "workItemName") ?? tab.title
    );
  }

  return null;
};

const isCustomMentionOption = (
  option: CustomMentionOption | null
): option is CustomMentionOption => option !== null;

// ============================================
// Component
// ============================================

const InputArea: React.FC<InputAreaProps> = memo(
  ({
    placeholder,
    isEditMode = false,
    initialContent,
    onEditSubmit,
    onEditSendNow,
    onEditCancel,
    editLabel,
    editHeaderActions = true,
    showEditHeader = true,
    quietEditSurface = false,
    editImages,
    surfaceBg = false,
    omitChatHeader = false,
    chatPanelPosition = "right",
    sessionId: propSessionId,
    onSubmitOverride,
    customMentionOptions,
    topRowPills,
    statusBanners,
    composerShellRef,
    disableStopWhenEmpty = false,
  }) => {
    const { t } = useTranslation("sessions");

    // ============================================
    // OS Agent Detection & Providers
    // ============================================

    // Populates `agentRegistryAtom` as a side-effect for downstream model selectors.
    useSessionDiscovery({ autoLoad: true });

    // Cursor IDE chats need a different model picker — Cursor's
    // available models (read live from the probe via CDP) live in a
    // *separate* universe from ORGII's provider/listing models, so the
    // regular `ModelPill` would have nothing to show. We swap the
    // whole pill at this level and let `CursorModelPill` own its
    // dropdown + per-composer last-used seed.
    const { sessionId } = useSessionId({ propSessionId });
    const isCursorIde = sessionId ? isCursorIdeSession(sessionId) : false;
    const workstationTabs = useAtomValue(mainPaneTabsAtom);
    const openedTabMentionOptions = useMemo(
      () =>
        workstationTabs
          .map(getOpenedTabMentionOption)
          .filter(isCustomMentionOption),
      [workstationTabs]
    );
    const mergedCustomMentionOptions = useMemo(
      () => [...openedTabMentionOptions, ...(customMentionOptions ?? [])],
      [openedTabMentionOptions, customMentionOptions]
    );

    // ============================================
    // Hooks
    // ============================================

    const {
      // Refs
      composerInputRef,
      containerRef,
      contextMenuKeyboardHandlerRef,
      slashCommandKeyboardHandlerRef,
      plusSlashCommandKeyboardHandlerRef,

      // Input state
      setIsInputFocused,
      handleInputBlur,
      handleContentChange,
      handleAtMention,
      handleAtMentionClose,
      isInputEmpty,

      // @ Mention
      showContextMenu,
      setShowContextMenu,
      atSearchQuery,
      setAtSearchQuery,
      recentFiles,
      handleAtSelect,
      handleCustomMentionSelect,
      customMentionOptions: activeCustomMentionOptions,

      // Slash command
      showSlashMenu,
      handleSlashCommand,
      handleSlashCommandClose,
      handleSlashSelect,
      handleModeSelect,
      currentMode,
      filteredSlashItems,
      slashLoading,
      slashQuery,
      prefetchSlashItems,

      // Upload
      fileInputRef,
      handleUploadClick,
      handleFileUpload,

      // Cite code
      isCiteCode,
      selectedCiteRange,
      citeFileName,
      clearCiteCode,

      // Message submission
      handleDivSubmit,
      isWpGeneWorking,
      isPendingCancel,

      // Session control
      interruptSession,
      resumeSession,
      isHosted,
      canStopAgent,
      canResume,
      isSessionTerminal,

      // Drag & drop
      dropTargetId,
      handleDragOver,
      handleDragLeave,
      handleDrop,

      // Context hooks
      replyInfo,
      setReplyInfo,
      currentRepoPath,

      // Image attachments
      attachedImages,
      handleImagePaste,
      hasImages,
    } = useInputArea({
      placeholder,
      sessionId: propSessionId,
      onSubmitOverride,
      customMentionOptions: mergedCustomMentionOptions,
    });

    const currentInputEmpty = isInputEmpty() && !hasImages;
    const stopSuppressedForEmptyInput =
      disableStopWhenEmpty && currentInputEmpty;
    const contextMenuVisible = showContextMenu;
    const mentionTreePosition =
      chatPanelPosition === "right" ? "left" : "right";

    // ── Plus-button slash menu (header mode) ─────────────────────────────────
    // Separate from the inline "/" slash menu so the two modes don't collide.
    const [showPlusSlashMenu, setShowPlusSlashMenu] = useState(false);
    const [plusSlashQuery, setPlusSlashQuery] = useState("");
    const [contextMenuKeyboardOpened, setContextMenuKeyboardOpened] =
      useState(false);

    const handleOpenSkillsTools = useCallback(() => {
      setPlusSlashQuery("");
      setShowPlusSlashMenu(true);
      // Pre-fetch items without opening the inline "/" menu.
      prefetchSlashItems("");
    }, [prefetchSlashItems]);

    const handleOpenContextMenu = useCallback(() => {
      window.dispatchEvent(new Event("terminal-snapshot-request"));
      setContextMenuKeyboardOpened(false);
      setShowContextMenu(true);
    }, [setShowContextMenu]);

    const handlePlusSlashClose = useCallback(() => {
      setShowPlusSlashMenu(false);
      setPlusSlashQuery("");
    }, []);

    const handlePlusSlashQueryChange = useCallback(
      (query: string) => {
        setPlusSlashQuery(query);
        prefetchSlashItems(query);
      },
      [prefetchSlashItems]
    );

    // ============================================
    // Edit Mode (extracted hook)
    // ============================================

    const attachedImageDataUrls = attachedImages.map((image) => image.dataUrl);

    const { editContainerRef, handleEditSubmit, handleEditKeyDown } =
      useEditMode({
        effectiveEditMode: isEditMode,
        isEditMode,
        initialContent,
        onEditSubmit,
        attachedImageDataUrls,
        onEditCancel,
        composerInputRef,
      });
    const handleEditSendNow = useCallback(() => {
      if (!composerInputRef.current || !onEditSendNow) return;
      const text = composerInputRef.current.getTextWithPills().trim();
      if (text) onEditSendNow(text, attachedImageDataUrls);
    }, [attachedImageDataUrls, onEditSendNow, composerInputRef]);

    // ============================================
    // Container Drag (extracted hook)
    // ============================================

    const {
      handleContainerDragOver,
      handleContainerDragLeave,
      handleContainerDrop,
      isDragOver,
    } = useContainerDrag({
      handleDragOver,
      handleDragLeave,
      handleDrop,
      composerInputRef,
      containerRef,
    });

    // ============================================
    // Context Menu close handler
    // ============================================

    const handleContextMenuClose = useCallback(() => {
      setContextMenuKeyboardOpened(false);
      setShowContextMenu(false);
      setAtSearchQuery("");
    }, [setShowContextMenu, setAtSearchQuery]);

    const handleKeyboardAtMention = useCallback(
      (query: string, position: { x: number; y: number }) => {
        window.dispatchEvent(new Event("terminal-snapshot-request"));
        setContextMenuKeyboardOpened(true);
        handleAtMention(query, position);
      },
      [handleAtMention]
    );

    // ============================================
    // Compact composer capsule
    // ============================================
    //
    // The pill row (single line + toolbar cluster on the right) stays until the
    // editor actually wraps onto a second line (or the user inserts a newline).
    // Focus alone no longer expands — you can keep typing in the pill.
    //
    // Expansion triggers:
    //   1. Editor content is visually multiline (ResizeObserver in InputEditor)
    //   2. Pending images, cite-code, reply-to, edit mode
    // Menus (`@`, inline `/`, and `+` skills/tools) retain the current
    // composer height and float from the editor slot instead of forcing the
    // compact pill row to become the expanded box.

    const {
      editorMultiline,
      suppressToolbarHover,
      acknowledgeToolbarHover,
      onEditorContentChange,
      onEditorBlur,
      observeCompact,
    } = useEditorExpansion({
      containerRef,
      composerInputRef,
      handleContentChange,
      handleInputBlur,
    });

    // Single content change handler:
    // - Always propagate text upstream
    // - Latch multiline=true on explicit newline
    // - Measure horizontal fill on growth — once ~80% full, swap layout
    // - Collapse to pill ONLY when the document is fully empty.
    //   Never treat “shorter text” as pill: backspace would briefly clear
    //   `editorMultiline` while 2–3 lines remain → pill shell flash/shadow.

    const isCursorCompactRow = useMemo(
      () =>
        !isEditMode &&
        !hasImages &&
        !isCiteCode &&
        !replyInfo.isReply &&
        !editorMultiline,
      [isEditMode, hasImages, isCiteCode, replyInfo.isReply, editorMultiline]
    );

    const compactShell = !isEditMode && isCursorCompactRow;
    useEffect(() => {
      if (!suppressToolbarHover) return;
      window.addEventListener("pointermove", acknowledgeToolbarHover, {
        once: true,
      });
      return () => {
        window.removeEventListener("pointermove", acknowledgeToolbarHover);
      };
    }, [acknowledgeToolbarHover, suppressToolbarHover]);

    // ── Pills — declared after isCursorCompactRow so compact prop is available.
    // For Cursor IDE chats we substitute ORGII's ModePill with CursorModePill,
    // and ORGII's ModelPill with CursorModelPill. The two pill sets drive
    // separate runtime domains and must never appear together.
    const modelPill =
      isCursorIde && sessionId ? (
        <CursorModelPill sessionId={sessionId} />
      ) : (
        <ModelPill />
      );
    const modePill =
      isCursorIde && sessionId ? (
        <CursorModePill sessionId={sessionId} />
      ) : (
        <ModePill />
      );

    // Sync compact state into the hook so its ResizeObserver gates
    // correctly. MUST run as an effect — calling observeCompact during
    // render fires `setState` synchronously and, when paired with even a
    // single oscillating parent re-render (e.g. OrgChatPanel flipping
    // launcher → ChatView), trips React's "Too many re-renders" guard.
    useEffect(() => {
      observeCompact(isCursorCompactRow);
    }, [isCursorCompactRow, observeCompact]);

    const editComposerBar = (
      <ComposerBar
        onAddContent={handleOpenContextMenu}
        onUpload={handleUploadClick}
        onOpenSkillsTools={handleOpenSkillsTools}
        dropdownDirection="down"
        toolbarItemGap={false}
        showContextInfo={!isCursorIde}
        editorSlot={
          <InputEditor
            composerInputRef={composerInputRef}
            showContextMenu={showContextMenu}
            contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
            showSlashMenu={showSlashMenu}
            slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
            showPlusSlashMenu={showPlusSlashMenu}
            plusSlashCommandKeyboardHandlerRef={
              plusSlashCommandKeyboardHandlerRef
            }
            onSlashCommand={handleSlashCommand}
            onSlashCommandClose={handleSlashCommandClose}
            slashTriggerMode="command"
            onContentChange={handleContentChange}
            onAtMention={handleKeyboardAtMention}
            onAtMentionClose={handleAtMentionClose}
            onSubmit={handleEditSubmit}
            onFocus={() => setIsInputFocused(true)}
            onBlur={handleInputBlur}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={t("input.editPlaceholder")}
            onImagePaste={handleImagePaste}
          />
        }
        leftPrefix={
          <>
            <CiteCodePreview
              isCiteCode={isCiteCode}
              selectedCiteRange={selectedCiteRange}
              citeFileName={citeFileName}
              onClear={clearCiteCode}
            />
            <ReplyInfoDisplay
              replyInfo={replyInfo}
              onClose={() => setReplyInfo({ isReply: false })}
            />
          </>
        }
        pills={
          <>
            {modePill}
            {modelPill}
          </>
        }
        submitButton={
          onEditSendNow ? (
            <div className="flex items-center gap-1">
              <Button
                variant="tertiary"
                size="mini"
                shape="circle"
                iconOnly
                htmlType="button"
                icon={<X size={13} strokeWidth={2} />}
                aria-label={t("common:actions.cancel")}
                className="enabled:hover:bg-fill-3 enabled:hover:text-text-1"
                onClick={onEditCancel}
              />
              <Button
                variant="tertiary"
                size="mini"
                shape="round"
                htmlType="button"
                className="enabled:hover:bg-fill-3 enabled:hover:text-text-1"
                onClick={handleEditSubmit}
              >
                {t("common:actions.save")}
              </Button>
              <Button
                variant="primary"
                size="mini"
                shape="round"
                htmlType="button"
                onClick={handleEditSendNow}
              >
                {t("common:actions.sendNow")}
              </Button>
            </div>
          ) : quietEditSurface ? (
            <Button
              variant="warning"
              size="mini"
              shape="round"
              htmlType="button"
              icon={<RotateCcw size={13} strokeWidth={2} />}
              onClick={handleEditSubmit}
            >
              {t("common:actions.resend")}
            </Button>
          ) : (
            <InputActions
              isInputEmpty={isInputEmpty() && !hasImages}
              isWpGeneWorking={false}
              isPendingCancel={false}
              isHosted={isHosted}
              canStopAgent={canStopAgent}
              canResume={canResume}
              isSessionTerminal={false}
              onSubmit={handleEditSubmit}
              onInterrupt={interruptSession}
              onResume={resumeSession}
            />
          )
        }
      />
    );

    // ============================================
    // Render
    // ============================================

    return (
      <div
        ref={containerRef}
        data-chat-input-shell
        data-testid="chat-input"
        className="flex w-full flex-col"
        onKeyDown={isEditMode ? handleEditKeyDown : undefined}
        onDragOver={handleContainerDragOver}
        onDragLeave={handleContainerDragLeave}
        onDrop={handleContainerDrop}
      >
        <div className="relative flex flex-col gap-0.5">
          {/* Header - only show in normal mode, not edit mode */}
          {!isEditMode && !omitChatHeader && <ChatHeader />}

          {!isEditMode && (
            <div className="relative z-10 flex min-w-0 items-center gap-1 overflow-x-auto px-0.5 pb-1.5 scrollbar-hide">
              {topRowPills}
              <PinnedActionsBar
                composerInputRef={composerInputRef}
                sessionId={sessionId}
              />
            </div>
          )}

          {!isEditMode && statusBanners}

          {isEditMode && quietEditSurface && showEditHeader && (
            <ChatStatusSegmentedBar
              testId="sent-edit-mode-card"
              segments={[
                {
                  key: "label",
                  className: "flex-1",
                  content: (
                    <span className="truncate font-medium">
                      {editLabel ?? t("input.editingSentMessage")}
                    </span>
                  ),
                },
              ]}
            />
          )}

          <ComposerShell
            ref={isEditMode ? editContainerRef : composerShellRef}
            data-chat-drop-target
            data-chat-drop-target-id={dropTargetId}
            variant={
              compactShell
                ? "pill"
                : isEditMode
                  ? quietEditSurface
                    ? "historyEdit"
                    : "embedded"
                  : surfaceBg
                    ? "default"
                    : "embedded"
            }
            className={
              isDragOver
                ? "!border-primary-6 !bg-[color-mix(in_srgb,var(--color-primary-6)_5%,var(--color-chat-input))] !shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_20%,transparent)]"
                : !isEditMode
                  ? "composer-breathing"
                  : quietEditSurface
                    ? "!border-warning-6 !shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-warning-6)_15%,transparent)]"
                    : undefined
            }
          >
            {/* Queued-message edit keeps its header/actions; history edit is a standalone input. */}
            {isEditMode && !quietEditSurface && showEditHeader && (
              <EditModeHeader
                editLabel={editLabel ?? t("input.editingSentMessage")}
                editHeaderActions={editHeaderActions}
                onEditCancel={onEditCancel}
                onEditSubmit={handleEditSubmit}
              />
            )}

            {/* Image Attachment Preview (new images) and edit-mode images (read-only) */}
            {isEditMode ? (
              <>
                {editImages && editImages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-6">
                    {editImages.map((dataUrl, idx) => (
                      <EditModeImageThumbnail
                        key={idx}
                        dataUrl={dataUrl}
                        alt={`Attached image ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
                <ImageAttachmentPreview
                  ownerId={dropTargetId}
                  className="px-6 pb-0.5"
                />
              </>
            ) : null}

            {isEditMode ? (
              editComposerBar
            ) : (
              <div className="flex min-h-0 w-full flex-col">
                <ImageAttachmentPreview ownerId={dropTargetId} />
                <ComposerBar
                  onAddContent={handleOpenContextMenu}
                  onUpload={handleUploadClick}
                  onOpenSkillsTools={handleOpenSkillsTools}
                  dropdownDirection="up"
                  toolbarItemGap={false}
                  repoPath={currentRepoPath}
                  inlineLayout={isCursorCompactRow}
                  showContextInfo={!isCursorIde}
                  editorSlot={
                    <InputEditor
                      key="chat-panel-input-editor"
                      composerInputRef={composerInputRef}
                      showContextMenu={showContextMenu}
                      contextMenuKeyboardHandlerRef={
                        contextMenuKeyboardHandlerRef
                      }
                      showSlashMenu={showSlashMenu}
                      slashCommandKeyboardHandlerRef={
                        slashCommandKeyboardHandlerRef
                      }
                      showPlusSlashMenu={showPlusSlashMenu}
                      plusSlashCommandKeyboardHandlerRef={
                        plusSlashCommandKeyboardHandlerRef
                      }
                      onSlashCommand={handleSlashCommand}
                      onSlashCommandClose={handleSlashCommandClose}
                      onContentChange={onEditorContentChange}
                      onAtMention={handleKeyboardAtMention}
                      onAtMentionClose={handleAtMentionClose}
                      onSubmit={() => void handleDivSubmit()}
                      onFocus={() => setIsInputFocused(true)}
                      onBlur={onEditorBlur}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      placeholder={placeholder || t("input.defaultPlaceholder")}
                      onImagePaste={handleImagePaste}
                      compact={isCursorCompactRow}
                    />
                  }
                  leftPrefix={
                    <>
                      <CiteCodePreview
                        isCiteCode={isCiteCode}
                        selectedCiteRange={selectedCiteRange}
                        citeFileName={citeFileName}
                        onClear={clearCiteCode}
                      />
                      <ReplyInfoDisplay
                        replyInfo={replyInfo}
                        onClose={() => setReplyInfo({ isReply: false })}
                      />
                    </>
                  }
                  pills={
                    <div
                      className={`inline-flex items-center ${
                        suppressToolbarHover ? "pointer-events-none" : ""
                      }`.trim()}
                    >
                      {modePill}
                      {modelPill}
                    </div>
                  }
                  submitButton={
                    <InputActions
                      isInputEmpty={currentInputEmpty}
                      isWpGeneWorking={
                        stopSuppressedForEmptyInput ? false : isWpGeneWorking
                      }
                      isPendingCancel={
                        stopSuppressedForEmptyInput ? false : isPendingCancel
                      }
                      isHosted={isHosted}
                      canStopAgent={
                        stopSuppressedForEmptyInput ? false : canStopAgent
                      }
                      canResume={canResume}
                      isSessionTerminal={isSessionTerminal}
                      onSubmit={() => void handleDivSubmit()}
                      onInterrupt={interruptSession}
                      onResume={resumeSession}
                    />
                  }
                />
              </div>
            )}
          </ComposerShell>
        </div>

        {/* Context Menu - rendered via portal to avoid clipping (lazy loaded) */}
        <ContextMenuPortal
          visible={contextMenuVisible}
          containerRef={containerRef}
          onClose={handleContextMenuClose}
          onSelect={handleAtSelect}
          customMentionOptions={activeCustomMentionOptions}
          onCustomMentionSelect={handleCustomMentionSelect}
          searchQuery={atSearchQuery}
          keyboardOpened={contextMenuKeyboardOpened}
          recentFiles={recentFiles}
          repoPath={currentRepoPath || undefined}
          keyboardHandlerRef={contextMenuKeyboardHandlerRef}
          treePosition={mentionTreePosition}
          placement={isEditMode ? "down" : "prefer-up"}
          anchorSelector="[data-editor-slot]"
        />

        {/* Slash Command Menu - inline "/" trigger */}
        <SlashCommandPortal
          visible={showSlashMenu}
          containerRef={containerRef}
          anchorSelector="[data-editor-slot]"
          placement={isEditMode ? "down" : "prefer-up"}
          items={filteredSlashItems}
          loading={slashLoading}
          currentMode={currentMode}
          searchQuery={slashQuery}
          onClose={handleSlashCommandClose}
          onSelect={handleSlashSelect}
          onModeSelect={handleModeSelect}
          keyboardHandlerRef={slashCommandKeyboardHandlerRef}
          showActionFlyouts
          onImageUpload={handleUploadClick}
        />

        {/* Slash Command Menu - "+" button trigger (header search mode) */}
        <SlashCommandPortal
          visible={showPlusSlashMenu}
          containerRef={containerRef}
          anchorSelector="[data-editor-slot]"
          placement={isEditMode ? "down" : "prefer-up"}
          items={filteredSlashItems}
          loading={slashLoading}
          currentMode={currentMode}
          searchQuery={plusSlashQuery}
          onClose={handlePlusSlashClose}
          onSelect={(item) => {
            handleSlashSelect(item);
            handlePlusSlashClose();
          }}
          onModeSelect={(mode) => {
            handleModeSelect(mode);
            handlePlusSlashClose();
          }}
          keyboardHandlerRef={plusSlashCommandKeyboardHandlerRef}
          searchMode="header"
          showActionFlyouts
          onSearchQueryChange={handlePlusSlashQueryChange}
          onImageUpload={() => {
            handlePlusSlashClose();
            handleUploadClick();
          }}
        />

        {/* Quick Upload Modal */}
        {/* Native system file picker — same as SessionCreator */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
      </div>
    );
  }
);

InputArea.displayName = "InputArea";

export default InputArea;
