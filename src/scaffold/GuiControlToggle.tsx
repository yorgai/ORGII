import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ArrowUp, Bot, MessageCircle, MousePointer2, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { sessionLaunch } from "@src/api/tauri/agent/session";
import {
  DISPATCH_CATEGORY,
  KEY_SOURCE,
  isHostedKey,
} from "@src/api/tauri/session";
import ComposerBar from "@src/components/ComposerBar";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import ComposerShell from "@src/components/ComposerShell";
import Message from "@src/components/Message";
import ModelSelectorPill from "@src/components/ModelSelectorPill";
import { VoiceInputButton, VoiceRecordingBar } from "@src/components/Voice";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import InputEditor from "@src/engines/ChatPanel/InputArea/components/InputEditor";
import { useEditorExpansion } from "@src/engines/ChatPanel/InputArea/hooks/useEditorExpansion";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import { type VoiceInputError, useVoiceInput } from "@src/hooks/voice";
import { UnifiedModelPalette } from "@src/scaffold/GlobalSpotlight/palettes";
import { collectIdeContext } from "@src/services/context/collectors";
import { voiceInputEnabledAtom } from "@src/store/platform/voiceInputAtom";
import {
  type LastModelSelection,
  creatorDefaultModelSelectionAtom,
  extractModelPair,
} from "@src/store/session/creatorDefaultModelAtom";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";
import {
  guiControlEnabledAtom,
  toggleGuiControlEnabledAtom,
} from "@src/store/ui/uiAtom";
import { invokeTauri } from "@src/util/platform/tauri";
import { BUILTIN_OS_DEF_ID } from "@src/util/session/sessionDispatch";

export const GUI_CONTROL_TOGGLE_SHORTCUT_ID = "toggle_gui_control";
export const GUI_CONTROL_SUBMIT_EVENT = "orgii:gui-control-submit";

const GUI_CONTROL_MODE = {
  INPUT: "input",
  SELECTION: "selection",
} as const;

type GuiControlMode = (typeof GUI_CONTROL_MODE)[keyof typeof GUI_CONTROL_MODE];
type GuiControlRunStatus = "idle" | "sending" | "running" | "error";

interface ModePillProps {
  mode: GuiControlMode;
  onClick: () => void;
}

const AgentControlModePill: React.FC<ModePillProps> = ({ mode, onClick }) => {
  const { t } = useTranslation("common");
  const isAnswer = mode === GUI_CONTROL_MODE.SELECTION;
  const Icon = isAnswer ? MessageCircle : MousePointer2;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border-2 px-2 text-[12px] font-medium text-text-2 transition-colors hover:bg-fill-2"
      aria-label={t("guiControl.toggleMode")}
    >
      <Icon size={14} strokeWidth={1.75} className="text-text-2" />
      <span>
        {isAnswer ? t("guiControl.selectionMode") : t("guiControl.inputMode")}
      </span>
    </button>
  );
};

export interface GuiControlSubmitDetail {
  mode: GuiControlMode;
  text: string;
  modelSelection: LastModelSelection | null;
}

function resolveControlModel(selection: LastModelSelection | null): {
  keySource: string;
  model?: string;
  accountId?: string;
} {
  if (!selection) return { keySource: KEY_SOURCE.OWN };
  if (isHostedKey(selection.keySource)) {
    return {
      keySource: KEY_SOURCE.HOSTED,
      model: selection.listingModel,
    };
  }
  return {
    keySource: KEY_SOURCE.OWN,
    model: selection.model,
    accountId: selection.selectedAccountId,
  };
}

function buildControlPrompt(mode: GuiControlMode, text: string): string {
  const instruction =
    mode === GUI_CONTROL_MODE.SELECTION
      ? "Answer the user's question about the current ORGII UI. Use GUI-reading/navigation actions if needed, but do not modify the UI unless the user explicitly asks."
      : "Control the ORGII GUI to complete the user's request. Navigate and use GUI automation actions when appropriate.";

  return `${instruction}\n\nUser request:\n${text}`;
}

function resolveControlModelLabel(
  selection: LastModelSelection | null
): string {
  return (
    selection?.listingModelDisplay ??
    selection?.model ??
    selection?.cliModelDisplay ??
    "default model"
  );
}

export function GuiControlToggle(): React.ReactNode {
  const { t } = useTranslation("common");
  const enabled = useAtomValue(guiControlEnabledAtom);
  const toggleGuiControlEnabled = useSetAtom(toggleGuiControlEnabledAtom);
  const voiceFeatureEnabled = useAtomValue(voiceInputEnabledAtom);
  const creatorDefaultLastModel = useValidatedLastPair();
  const setCreatorDefaultModel = useSetAtom(creatorDefaultModelSelectionAtom);
  const [selectorState, setSelectorState] = useAtom(modelSelectorAtom);
  const isModelOpen = selectorState.isOpen;
  const containerRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<ComposerInputRef>(null);
  const controlSessionIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const contextMenuKeyboardHandlerRef = useRef<
    ((event: React.KeyboardEvent) => boolean) | null
  >(null);
  const [mode, setMode] = useState<GuiControlMode>(GUI_CONTROL_MODE.INPUT);
  const [draftText, setDraftText] = useState("");
  const [runStatus, setRunStatus] = useState<GuiControlRunStatus>("idle");

  const placeholder =
    mode === GUI_CONTROL_MODE.SELECTION
      ? t("guiControl.selectionPlaceholder")
      : t("guiControl.inputPlaceholder");

  const handleVoiceCommit = useCallback((transcript: string) => {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    const editor = composerInputRef.current;
    if (!editor) return;
    const existing = editor.getText();
    const separator = existing.length === 0 || /\s$/.test(existing) ? "" : " ";
    const next = `${existing}${separator}${trimmed}`;
    editor.setContent(next);
    editor.focus();
    setDraftText(next);
  }, []);

  const handleVoiceError = useCallback(
    (error: VoiceInputError) => {
      if (error.code === "permission-denied") {
        Message.error(t("sessions:input.voiceErrorPermission"));
      } else if (error.code === "unsupported") {
        Message.error(t("sessions:input.voiceErrorUnsupported"));
      } else if (error.code === "audio-capture") {
        Message.error(t("sessions:input.voiceErrorAudio"));
      } else if (error.code !== "no-speech" && error.code !== "aborted") {
        Message.error(t("sessions:input.voiceErrorGeneric"));
      }
    },
    [t]
  );

  const voice = useVoiceInput({
    onCommit: handleVoiceCommit,
    onError: handleVoiceError,
  });

  const showVoiceUi = voiceFeatureEnabled && voice.isRecording;

  const handleInputBlur = useCallback(() => undefined, []);

  const { editorMultiline, onEditorContentChange, observeCompact } =
    useEditorExpansion({
      containerRef,
      composerInputRef,
      handleContentChange: setDraftText,
      handleInputBlur,
    });

  const isCompactRow = !editorMultiline;

  useEffect(() => {
    observeCompact(isCompactRow);
  }, [isCompactRow, observeCompact]);

  useEffect(() => {
    if (!enabled || showVoiceUi) return;
    const frame = requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, showVoiceUi]);

  const handleSubmit = useCallback(() => {
    const text = composerInputRef.current?.getTextWithPills().trim() ?? "";
    if (!text || sendingRef.current) return;

    const prompt = buildControlPrompt(mode, text);
    const modelConfig = resolveControlModel(creatorDefaultLastModel);
    const ideContext = collectIdeContext({ expectedRepoPath: null });
    sendingRef.current = true;
    setRunStatus("sending");

    void (async () => {
      try {
        const existingSessionId = controlSessionIdRef.current;
        if (existingSessionId) {
          await invokeTauri("agent_send_message", {
            sessionId: existingSessionId,
            content: prompt,
            ...(modelConfig.model ? { model: modelConfig.model } : {}),
            ...(modelConfig.accountId
              ? { accountId: modelConfig.accountId }
              : {}),
            ideContext,
          });
        } else {
          const result = await sessionLaunch({
            category: DISPATCH_CATEGORY.RUST_AGENT,
            content: prompt,
            name: "Agent Control",
            agentDefinitionId: BUILTIN_OS_DEF_ID,
            keySource: modelConfig.keySource,
            ...(modelConfig.model ? { model: modelConfig.model } : {}),
            ...(modelConfig.accountId
              ? { accountId: modelConfig.accountId }
              : {}),
            ideContext,
          });
          controlSessionIdRef.current = result.sessionId;
        }

        setRunStatus("running");

        window.dispatchEvent(
          new CustomEvent<GuiControlSubmitDetail>(GUI_CONTROL_SUBMIT_EVENT, {
            detail: { mode, text, modelSelection: creatorDefaultLastModel },
          })
        );

        composerInputRef.current?.clear();
        setDraftText("");
      } catch (error) {
        setRunStatus("error");
        Message.error(error instanceof Error ? error.message : String(error));
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [creatorDefaultLastModel, mode]);

  const handleClose = useCallback(() => {
    if (voice.isRecording) voice.cancel();
    if (isModelOpen) setSelectorState({ isOpen: false });
    toggleGuiControlEnabled();
  }, [isModelOpen, setSelectorState, toggleGuiControlEnabled, voice]);

  const handleOpenModelSelector = useCallback(() => {
    setSelectorState({ isOpen: true });
  }, [setSelectorState]);

  const handleCloseModelSelector = useCallback(() => {
    setSelectorState({ isOpen: false });
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [setSelectorState]);

  const handleModelConfigChange = useCallback(
    (config: AdvancedConfig) => {
      setCreatorDefaultModel(extractModelPair(config));
      handleCloseModelSelector();
    },
    [handleCloseModelSelector, setCreatorDefaultModel]
  );

  const handleToggleMode = useCallback(() => {
    setMode((currentMode) =>
      currentMode === GUI_CONTROL_MODE.INPUT
        ? GUI_CONTROL_MODE.SELECTION
        : GUI_CONTROL_MODE.INPUT
    );
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!enabled || !voiceFeatureEnabled) return;
    const node = containerRef.current;
    if (!node) return;
    let shortcutActive = false;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key.toLowerCase() !== "m" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      shortcutActive = true;
      voice.start();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!shortcutActive) return;
      if (event.key.toLowerCase() !== "m" && event.key !== "Control") return;
      event.preventDefault();
      event.stopPropagation();
      shortcutActive = false;
      voice.stop();
    };
    node.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp, true);
    return () => {
      node.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [enabled, voice, voiceFeatureEnabled]);

  if (!enabled) return null;

  const elevatedShadowClass =
    "shadow-[0_18px_48px_rgba(0,0,0,0.24)] hover:shadow-[0_18px_48px_rgba(0,0,0,0.24)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_15%,transparent),0_18px_48px_rgba(0,0,0,0.24)] dark:shadow-[0_18px_56px_rgba(0,0,0,0.55)] dark:hover:shadow-[0_18px_56px_rgba(0,0,0,0.55)] dark:focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-primary-6)_18%,transparent),0_18px_56px_rgba(0,0,0,0.55)]";
  const controlModelLabel = resolveControlModelLabel(creatorDefaultLastModel);
  const statusLabel =
    runStatus === "sending"
      ? t("status.sending")
      : runStatus === "error"
        ? t("status.error")
        : t("status.running");
  const showStatusLine = runStatus !== "idle" || controlSessionIdRef.current;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center px-6 pb-6 pt-16"
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-bg-1/95 via-bg-1/70 to-transparent"
        aria-hidden
      />
      {showStatusLine && (
        <div className="pointer-events-auto z-10 mb-2 flex max-w-[min(720px,calc(100vw-48px))] items-center gap-2 rounded-full border border-border-2 bg-bg-1/90 px-3 py-1 text-[12px] text-text-2 shadow-sm backdrop-blur">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-1 text-primary-6">
            <Bot size={12} strokeWidth={1.8} />
          </span>
          <span className="font-medium text-text-1">
            {t("terminology.osAgent")}
          </span>
          <span className="text-text-4">·</span>
          <span>{statusLabel}</span>
          <span className="text-text-4">·</span>
          <span className="max-w-[260px] truncate">{controlModelLabel}</span>
        </div>
      )}
      <ComposerShell
        variant={isCompactRow ? "pill" : "default"}
        className={`pointer-events-auto z-10 w-[min(720px,calc(100vw-48px))] ${elevatedShadowClass}`}
        data-action="gui-control.input"
      >
        {showVoiceUi ? (
          <VoiceRecordingBar
            elapsedSeconds={voice.elapsedSeconds}
            onCancel={voice.cancel}
            onAccept={voice.stop}
          />
        ) : (
          <ComposerBar
            onAddContent={() => composerInputRef.current?.focus()}
            onUpload={() => composerInputRef.current?.focus()}
            dropdownDirection="up"
            toolbarItemGap={false}
            inlineLayout={isCompactRow}
            hideAddButton
            showContextInfo={false}
            leftPrefix={
              <>
                <button
                  type="button"
                  onClick={handleClose}
                  className={`${INPUT_AREA_BUTTONS.iconButtonBase} shrink-0 leading-none`}
                  style={{ lineHeight: 0 }}
                  aria-label={t("actions.close")}
                >
                  <X size={INPUT_AREA_BUTTONS.iconSize} strokeWidth={1.75} />
                </button>
                <AgentControlModePill mode={mode} onClick={handleToggleMode} />
              </>
            }
            editorSlot={
              <InputEditor
                composerInputRef={composerInputRef}
                showContextMenu={false}
                contextMenuKeyboardHandlerRef={contextMenuKeyboardHandlerRef}
                onContentChange={onEditorContentChange}
                onSubmit={handleSubmit}
                placeholder={placeholder}
                compact={isCompactRow}
                onBeforeNewline={() => onEditorContentChange("\n")}
                slashTriggerMode="context"
              />
            }
            pills={
              <ModelSelectorPill
                selection={creatorDefaultLastModel}
                defaultLabel={t("guiControl.selectModel")}
                active={isModelOpen}
                className="h-[28px] max-w-[220px] shrink-0 text-[13px]"
                dataTestId="agent-control-model-pill"
                ariaLabel={t("guiControl.selectModel")}
                onClick={handleOpenModelSelector}
              />
            }
            submitButton={
              <>
                {voiceFeatureEnabled && (
                  <VoiceInputButton
                    onPressStart={voice.start}
                    onPressEnd={voice.stop}
                    disabled={!voice.isSupported}
                  />
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!draftText.trim()}
                  className={`flex ${INPUT_AREA_BUTTONS.iconButtonSizeClass} shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus:outline-none ${
                    draftText.trim()
                      ? INPUT_AREA_BUTTONS.iconButtonActive
                      : INPUT_AREA_BUTTONS.iconButtonInactive
                  }`}
                  style={{ lineHeight: 0 }}
                  aria-label={t("guiControl.submit")}
                >
                  <ArrowUp size={INPUT_AREA_BUTTONS.iconSize} strokeWidth={2} />
                </button>
              </>
            }
          />
        )}
      </ComposerShell>
      <UnifiedModelPalette
        isOpen={isModelOpen}
        onClose={handleCloseModelSelector}
        advancedConfig={creatorDefaultLastModel ?? {}}
        onConfigChange={handleModelConfigChange}
        dispatchCategoryOverride={DISPATCH_CATEGORY.RUST_AGENT}
      />
    </div>
  );
}

export default GuiControlToggle;
