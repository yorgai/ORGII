import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import ComposerBar from "@src/components/ComposerBar";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import { VoiceInputButton, VoiceRecordingBar } from "@src/components/Voice";
import type { UseVoiceInputResult } from "@src/hooks/voice";
import { useGlobalTokens } from "@src/modules/WorkStation/Browser/hooks/useGlobalTokens";
import type { TokenDefinition } from "@src/store/workstation/browser/tokens/tokenAtoms";

import CiteCodePreview from "./CiteCodePreview";
import ImageAttachmentPreview from "./ImageAttachmentPreview";
import InputActions from "./InputActions";
import InputEditor from "./InputEditor";
import ReplyInfoDisplay from "./ReplyInfoDisplay";

interface SharedComposerBarProps {
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  showContextMenu: boolean;
  contextMenuKeyboardHandlerRef: React.MutableRefObject<
    ((event: React.KeyboardEvent) => boolean) | null
  >;
  showSlashMenu: boolean;
  slashCommandKeyboardHandlerRef: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
  showPlusSlashMenu: boolean;
  plusSlashCommandKeyboardHandlerRef: React.MutableRefObject<
    ((event: KeyboardEvent) => boolean) | null
  >;
  onSlashCommand: (query: string) => void;
  onSlashCommandClose: () => void;
  onAtMention: (query: string, position: { x: number; y: number }) => void;
  onAtMentionClose: () => void;
  onFocus: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onImagePaste: (files: File[]) => void;
  onAddContent: () => void;
  onUpload: () => void;
  onOpenSkillsTools: () => void;
  isCiteCode: boolean;
  selectedCiteRange: { start: number; end: number } | null;
  citeFileName: string;
  onClearCiteCode: () => void;
  replyInfo: { isReply: boolean };
  onClearReplyInfo: () => void;
  modePill: React.ReactNode;
  modelPill: React.ReactNode;
  isHosted: boolean;
  canStopAgent: boolean;
  canResume: boolean;
  onInterrupt: () => Promise<void>;
  onResume: () => Promise<void>;
  isCursorIde: boolean;
}

interface EditComposerBarProps extends SharedComposerBarProps {
  onContentChange: (text: string) => void;
  onBlur: () => void;
  onSubmit: (capturedText?: string) => void;
  onEditCancel?: () => void;
  onEditSendNow?: () => void;
  quietEditSurface: boolean;
  isInputEmpty: boolean;
  hasImages: boolean;
}

const ComposerPrefixes: React.FC<
  Pick<
    SharedComposerBarProps,
    | "isCiteCode"
    | "selectedCiteRange"
    | "citeFileName"
    | "onClearCiteCode"
    | "replyInfo"
    | "onClearReplyInfo"
  >
> = ({
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
}) => (
  <>
    <CiteCodePreview
      isCiteCode={isCiteCode}
      selectedCiteRange={selectedCiteRange}
      citeFileName={citeFileName}
      onClear={onClearCiteCode}
    />
    <ReplyInfoDisplay replyInfo={replyInfo} onClose={onClearReplyInfo} />
  </>
);

const FALLBACK_COLOR_TOKENS: TokenDefinition[] = [
  { name: "color-primary-1", value: "var(--color-primary-1)", source: "theme" },
  { name: "color-primary-2", value: "var(--color-primary-2)", source: "theme" },
  { name: "color-primary-3", value: "var(--color-primary-3)", source: "theme" },
  { name: "color-primary-4", value: "var(--color-primary-4)", source: "theme" },
  { name: "color-primary-5", value: "var(--color-primary-5)", source: "theme" },
  { name: "color-primary-6", value: "var(--color-primary-6)", source: "theme" },
  { name: "color-primary-7", value: "var(--color-primary-7)", source: "theme" },
];

const COLOR_TOKEN_NAME_RE =
  /^(?:color-)?(?:primary|danger|success|warning|bg|border|text|fill)-\d+$/;
const ANY_COLOR_TOKEN_RE =
  /\b(?:color-)?(?:primary|danger|success|warning|bg|border|text|fill)-\d+\b/;

function buildColorTokens(tokens: TokenDefinition[]): TokenDefinition[] {
  const colorTokens = tokens
    .filter((token) => COLOR_TOKEN_NAME_RE.test(token.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return colorTokens.length > 0 ? colorTokens : FALLBACK_COLOR_TOKENS;
}

function applyColorToken(text: string, token: string): string {
  if (ANY_COLOR_TOKEN_RE.test(text)) {
    return text.replace(ANY_COLOR_TOKEN_RE, token);
  }

  const trimmed = text.trimEnd();
  if (trimmed.length === 0) {
    return token;
  }

  if (/\bblue\b$/i.test(trimmed)) {
    return trimmed.replace(/\bblue\b$/i, token);
  }

  return `${trimmed} ${token}`;
}

const ComposerColorTokenPicker: React.FC<{
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  repoPath?: string;
}> = ({ composerInputRef, repoPath }) => {
  const { tokens, scan } = useGlobalTokens({ repoPath, autoScan: false });
  const colorTokens = buildColorTokens(tokens);
  const [open, setOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = () => {
    setSelectedToken(
      composerInputRef.current?.getText().match(ANY_COLOR_TOKEN_RE)?.[0] ?? null
    );
    setOpen((value) => {
      const nextOpen = !value;
      if (nextOpen && repoPath && tokens.length === 0) {
        void scan();
      }
      return nextOpen;
    });
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (
        root &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectToken = (token: string) => {
    const editor = composerInputRef.current;
    if (!editor) return;

    editor.setContent(applyColorToken(editor.getText(), token));
    editor.focus();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="tertiary"
        appearance="ghost"
        size="small"
        shape="circle"
        iconOnly
        htmlType="button"
        icon={<SlidersHorizontal size={15} strokeWidth={1.8} />}
        className="h-7 w-7"
        aria-label="Choose color token"
        aria-expanded={open}
        onClick={toggleOpen}
        onMouseDown={(event) => event.preventDefault()}
        data-testid="composer-color-token-button"
      />
      {open && (
        <div
          className="absolute bottom-full left-0 z-50 mb-2 max-h-[344px] w-[230px] overflow-y-auto rounded-xl border border-border-2 bg-bg-2 p-2 shadow-xl"
          role="listbox"
          aria-label="Color tokens"
          data-testid="composer-color-token-menu"
        >
          {colorTokens.map((token) => {
            const selected = token.name === selectedToken;
            return (
              <button
                key={token.name}
                type="button"
                className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${
                  selected
                    ? "bg-fill-2 text-text-1"
                    : "text-text-2 hover:bg-fill-1 hover:text-text-1"
                }`}
                role="option"
                aria-selected={selected}
                title={token.source}
                onClick={() => selectToken(token.name)}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-md border border-border-2"
                  style={{ backgroundColor: token.value }}
                  aria-hidden="true"
                />
                <span className="truncate">{token.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const EditComposerBar: React.FC<EditComposerBarProps> = ({
  composerInputRef,
  showContextMenu,
  contextMenuKeyboardHandlerRef,
  showSlashMenu,
  slashCommandKeyboardHandlerRef,
  showPlusSlashMenu,
  plusSlashCommandKeyboardHandlerRef,
  onSlashCommand,
  onSlashCommandClose,
  onContentChange,
  onAtMention,
  onAtMentionClose,
  onSubmit,
  onFocus,
  onBlur,
  onDragOver,
  onDragLeave,
  onDrop,
  onImagePaste,
  onAddContent,
  onUpload,
  onOpenSkillsTools,
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
  modePill,
  modelPill,
  onEditCancel,
  onEditSendNow,
  quietEditSurface,
  isInputEmpty,
  hasImages,
  isHosted,
  canStopAgent,
  canResume,
  onInterrupt,
  onResume,
  isCursorIde,
}) => {
  const { t } = useTranslation("sessions");

  return (
    <ComposerBar
      onAddContent={onAddContent}
      onUpload={onUpload}
      onOpenSkillsTools={onOpenSkillsTools}
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
          onSlashCommand={onSlashCommand}
          onSlashCommandClose={onSlashCommandClose}
          slashTriggerMode="command"
          onContentChange={onContentChange}
          onAtMention={onAtMention}
          onAtMentionClose={onAtMentionClose}
          onSubmit={onSubmit}
          onFocus={onFocus}
          onBlur={onBlur}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          placeholder={t("input.editPlaceholder")}
          onImagePaste={onImagePaste}
        />
      }
      leftPrefix={
        <ComposerPrefixes
          isCiteCode={isCiteCode}
          selectedCiteRange={selectedCiteRange}
          citeFileName={citeFileName}
          onClearCiteCode={onClearCiteCode}
          replyInfo={replyInfo}
          onClearReplyInfo={onClearReplyInfo}
        />
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
              onClick={() => onSubmit()}
            >
              {t("common:actions.save")}
            </Button>
            <Button
              variant="primary"
              size="mini"
              shape="round"
              htmlType="button"
              onClick={onEditSendNow}
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
            onClick={() => onSubmit()}
          >
            {t("common:actions.resend")}
          </Button>
        ) : (
          <InputActions
            isInputEmpty={isInputEmpty && !hasImages}
            isWpGeneWorking={false}
            isPendingCancel={false}
            isHosted={isHosted}
            canStopAgent={canStopAgent}
            canResume={canResume}
            isSessionTerminal={false}
            onSubmit={onSubmit}
            onInterrupt={onInterrupt}
            onResume={onResume}
          />
        )
      }
    />
  );
};

interface NormalComposerContentProps extends SharedComposerBarProps {
  showVoiceUi: boolean;
  voice: UseVoiceInputResult;
  currentRepoPath?: string;
  isCursorCompactRow: boolean;
  suppressToolbarHover: boolean;
  onContentChange: (text: string) => void;
  onBlur: () => void;
  onSubmit: (capturedText?: string) => void;
  placeholder?: string;
  currentInputEmpty: boolean;
  stopSuppressedForEmptyInput: boolean;
  isWpGeneWorking: boolean;
  isPendingCancel: boolean;
  isSessionTerminal: boolean;
  voiceFeatureEnabled: boolean;
  dropTargetId: string;
}

export const NormalComposerContent: React.FC<NormalComposerContentProps> = ({
  composerInputRef,
  showContextMenu,
  contextMenuKeyboardHandlerRef,
  showSlashMenu,
  slashCommandKeyboardHandlerRef,
  showPlusSlashMenu,
  plusSlashCommandKeyboardHandlerRef,
  onSlashCommand,
  onSlashCommandClose,
  onContentChange,
  onAtMention,
  onAtMentionClose,
  onSubmit,
  onFocus,
  onBlur,
  onDragOver,
  onDragLeave,
  onDrop,
  onImagePaste,
  onAddContent,
  onUpload,
  onOpenSkillsTools,
  isCiteCode,
  selectedCiteRange,
  citeFileName,
  onClearCiteCode,
  replyInfo,
  onClearReplyInfo,
  modePill,
  modelPill,
  isHosted,
  canStopAgent,
  canResume,
  onInterrupt,
  onResume,
  isCursorIde,
  showVoiceUi,
  voice,
  currentRepoPath,
  isCursorCompactRow,
  suppressToolbarHover,
  placeholder,
  currentInputEmpty,
  stopSuppressedForEmptyInput,
  isWpGeneWorking,
  isPendingCancel,
  isSessionTerminal,
  voiceFeatureEnabled,
  dropTargetId,
}) => {
  const { t } = useTranslation("sessions");

  return (
    <div className="flex min-h-0 w-full flex-col">
      <ImageAttachmentPreview ownerId={dropTargetId} />
      {showVoiceUi ? (
        <VoiceRecordingBar
          elapsedSeconds={voice.elapsedSeconds}
          onCancel={voice.cancel}
          onAccept={voice.stop}
          onAddContent={onAddContent}
          compact={isCursorCompactRow}
        />
      ) : (
        <ComposerBar
          onAddContent={onAddContent}
          onUpload={onUpload}
          onOpenSkillsTools={onOpenSkillsTools}
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
              contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
              showSlashMenu={showSlashMenu}
              slashCommandKeyboardHandlerRef={slashCommandKeyboardHandlerRef}
              showPlusSlashMenu={showPlusSlashMenu}
              plusSlashCommandKeyboardHandlerRef={
                plusSlashCommandKeyboardHandlerRef
              }
              onSlashCommand={onSlashCommand}
              onSlashCommandClose={onSlashCommandClose}
              onContentChange={onContentChange}
              onAtMention={onAtMention}
              onAtMentionClose={onAtMentionClose}
              onSubmit={onSubmit}
              onFocus={onFocus}
              onBlur={onBlur}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              placeholder={placeholder || t("input.defaultPlaceholder")}
              onImagePaste={onImagePaste}
              compact={isCursorCompactRow}
            />
          }
          leftPrefix={
            <ComposerPrefixes
              isCiteCode={isCiteCode}
              selectedCiteRange={selectedCiteRange}
              citeFileName={citeFileName}
              onClearCiteCode={onClearCiteCode}
              replyInfo={replyInfo}
              onClearReplyInfo={onClearReplyInfo}
            />
          }
          leftTools={
            <ComposerColorTokenPicker
              composerInputRef={composerInputRef}
              repoPath={currentRepoPath}
            />
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
            <div className="flex h-7 items-center gap-0.5">
              {voiceFeatureEnabled && (
                <VoiceInputButton
                  onPressStart={voice.start}
                  onPressEnd={voice.stop}
                  disabled={!voice.isSupported}
                />
              )}
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
                onSubmit={onSubmit}
                onInterrupt={onInterrupt}
                onResume={onResume}
              />
            </div>
          }
        />
      )}
    </div>
  );
};
