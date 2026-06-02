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
import { RotateCcw, X } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ComposerBar from "@src/components/ComposerBar";
import ComposerShell from "@src/components/ComposerShell";
import { ChatStatusSegmentedBar } from "@src/engines/ChatPanel/components/ChatStatusBanners";
import { useInputArea } from "@src/engines/ChatPanel/hooks/useInputArea";
import type {
  CustomMentionOption,
  SubmitOverrideInput,
} from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { useSessionDiscovery } from "@src/engines/SessionCore";
import { useSessionId } from "@src/engines/SessionCore/hooks/session";
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
  onEditSubmit?: (text: string) => void;
  /** Callback when edit is submitted and immediately sent */
  onEditSendNow?: (text: string) => void;
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
  /** Explicit session ID for this composer surface. */
  sessionId?: string;
  onSubmitOverride?: (input: SubmitOverrideInput) => Promise<boolean>;
  customMentionOptions?: ReadonlyArray<CustomMentionOption>;
}

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
    sessionId: propSessionId,
    onSubmitOverride,
    customMentionOptions,
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

    // ============================================
    // Hooks
    // ============================================

    const {
      // Refs
      tiptapRef,
      containerRef,
      atDropdownRef,
      contextMenuKeyboardHandlerRef,
      slashCommandKeyboardHandlerRef,

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
      handleDragOver,
      handleDragLeave,
      handleDrop,

      // Context hooks
      replyInfo,
      setReplyInfo,
      currentRepoPath,

      // Image attachments
      handleImagePaste,
      hasImages,
    } = useInputArea({
      placeholder,
      sessionId: propSessionId,
      onSubmitOverride,
      customMentionOptions,
    });

    const contextMenuVisible = showContextMenu;

    // ── Plus-button slash menu (header mode) ─────────────────────────────────
    // Separate from the inline "/" slash menu so the two modes don't collide.
    const [showPlusSlashMenu, setShowPlusSlashMenu] = useState(false);
    const [plusSlashQuery, setPlusSlashQuery] = useState("");

    const handleOpenSkillsTools = useCallback(() => {
      setPlusSlashQuery("");
      setShowPlusSlashMenu(true);
      // Pre-fetch items without opening the inline "/" menu.
      prefetchSlashItems("");
    }, [prefetchSlashItems]);

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

    // Route "/" trigger through the plus-button menu so both entry points
    // show identical content (Mode, Models, Image, Skills, Actions).
    const handleSlashCommandViaPlus = useCallback(
      (query: string) => {
        setPlusSlashQuery(query);
        setShowPlusSlashMenu(true);
        prefetchSlashItems(query);
      },
      [prefetchSlashItems]
    );

    // ============================================
    // Edit Mode (extracted hook)
    // ============================================

    const { editContainerRef, handleEditSubmit, handleEditKeyDown } =
      useEditMode({
        effectiveEditMode: isEditMode,
        isEditMode,
        initialContent,
        onEditSubmit,
        onEditCancel,
        tiptapRef,
      });
    const handleEditSendNow = useCallback(() => {
      if (!tiptapRef.current || !onEditSendNow) return;
      const text = tiptapRef.current.getTextWithPills().trim();
      if (text) onEditSendNow(text);
    }, [onEditSendNow, tiptapRef]);

    // ============================================
    // Container Drag (extracted hook)
    // ============================================

    const {
      handleContainerDragOver,
      handleContainerDragLeave,
      handleContainerDrop,
    } = useContainerDrag({ handleDragOver, handleDragLeave, handleDrop });

    // ============================================
    // Context Menu close handler
    // ============================================

    const handleContextMenuClose = useCallback(() => {
      setShowContextMenu(false);
      setAtSearchQuery("");
    }, [setShowContextMenu, setAtSearchQuery]);

    // ============================================
    // Cursor-style compact capsule
    // ============================================
    //
    // The pill row (single line + toolbar cluster on the right) stays until the
    // editor actually wraps onto a second line (or the user inserts a newline).
    // Focus alone no longer expands — you can keep typing in the pill.
    //
    // Expansion triggers:
    //   1. Editor content is visually multiline (ResizeObserver in InputEditor)
    //   2. Pending images, cite-code, reply-to, slash/@ menus, edit mode
    //      (each adds chrome that doesn't fit in one row)

    const {
      editorMultiline,
      onEditorContentChange,
      onEditorBlur,
      observeCompact,
    } = useEditorExpansion({
      containerRef,
      tiptapRef,
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
        !editorMultiline &&
        !showContextMenu &&
        !showPlusSlashMenu,
      [
        isEditMode,
        hasImages,
        isCiteCode,
        replyInfo.isReply,
        editorMultiline,
        showContextMenu,
        showPlusSlashMenu,
      ]
    );

    const compactShell = !isEditMode && isCursorCompactRow;

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
        onAddContent={() => setShowContextMenu(true)}
        onUpload={handleUploadClick}
        onOpenSkillsTools={handleOpenSkillsTools}
        dropdownDirection="down"
        toolbarItemGap={false}
        showContextInfo={!isCursorIde}
        editorSlot={
          <InputEditor
            tiptapRef={tiptapRef}
            showContextMenu={showContextMenu}
            contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
            showSlashMenu={showPlusSlashMenu}
            slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
            onSlashCommand={handleSlashCommandViaPlus}
            onSlashCommandClose={handlePlusSlashClose}
            onContentChange={handleContentChange}
            onAtMention={handleAtMention}
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

          {/* Pinned actions quick-access bar — only in non-edit chat mode */}
          {!isEditMode && <PinnedActionsBar tiptapRef={tiptapRef} />}

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
            ref={isEditMode ? editContainerRef : undefined}
            data-chat-drop-target
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
              !isEditMode
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

            {/* Image Attachment Preview (new images) or edit-mode images (read-only) */}
            {isEditMode && editImages && editImages.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {editImages.map((dataUrl, idx) => (
                  <EditModeImageThumbnail
                    key={idx}
                    dataUrl={dataUrl}
                    alt={`Attached image ${idx + 1}`}
                  />
                ))}
              </div>
            ) : isEditMode ? (
              <ImageAttachmentPreview />
            ) : null}

            {isEditMode ? (
              editComposerBar
            ) : (
              <div className="flex min-h-0 w-full flex-col">
                <ImageAttachmentPreview />
                <ComposerBar
                  onAddContent={() => setShowContextMenu(true)}
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
                      tiptapRef={tiptapRef}
                      showContextMenu={showContextMenu}
                      contextMenuKeyboardHandlerRef={
                        contextMenuKeyboardHandlerRef
                      }
                      showSlashMenu={showPlusSlashMenu}
                      slashCommandKeyboardHandlerRef={
                        slashCommandKeyboardHandlerRef
                      }
                      onSlashCommand={handleSlashCommandViaPlus}
                      onSlashCommandClose={handlePlusSlashClose}
                      onContentChange={onEditorContentChange}
                      onAtMention={handleAtMention}
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
                    <>
                      {modePill}
                      {modelPill}
                    </>
                  }
                  submitButton={
                    <InputActions
                      isInputEmpty={isInputEmpty() && !hasImages}
                      isWpGeneWorking={isWpGeneWorking}
                      isPendingCancel={isPendingCancel}
                      isHosted={isHosted}
                      canStopAgent={canStopAgent}
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

          {/* Hidden anchor for dropdown position calculation */}
          <div
            ref={atDropdownRef}
            className="absolute bottom-full left-0 mb-2"
            style={{ pointerEvents: "none" }}
          />
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
          recentFiles={recentFiles}
          repoPath={currentRepoPath || undefined}
          keyboardHandlerRef={contextMenuKeyboardHandlerRef}
        />

        {/* Slash Command Menu - inline "/" trigger */}
        <SlashCommandPortal
          visible={showSlashMenu}
          containerRef={containerRef}
          items={filteredSlashItems}
          loading={slashLoading}
          currentMode={currentMode}
          searchQuery={slashQuery}
          onClose={handleSlashCommandClose}
          onSelect={handleSlashSelect}
          onModeSelect={handleModeSelect}
          keyboardHandlerRef={slashCommandKeyboardHandlerRef}
        />

        {/* Slash Command Menu - "+" button trigger (header search mode) */}
        <SlashCommandPortal
          visible={showPlusSlashMenu}
          containerRef={containerRef}
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
          keyboardHandlerRef={slashCommandKeyboardHandlerRef}
          searchMode="header"
          showActionFlyouts
          onSearchQueryChange={handlePlusSlashQueryChange}
          onImageUpload={() => {
            handlePlusSlashClose();
            handleUploadClick();
          }}
          direction={isEditMode ? "down" : "up"}
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
