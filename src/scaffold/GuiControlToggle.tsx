import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ArrowUp,
  BrushCleaning,
  CheckCircle2,
  Loader2,
  MessageCircle,
  MousePointer2,
  MousePointerClick,
  X,
  XCircle,
} from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type SessionLaunchResult,
  sessionLaunch,
} from "@src/api/tauri/agent/session";
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
import { extractArgsSummary } from "@src/engines/ChatPanel/blocks/ToolCallBlock/helpers/argsSummary";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import type { AgentExecMode } from "@src/features/SessionCreator/config";
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
import { upsertSession } from "@src/store/session/sessionAtom";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";
import {
  closeGuiControlComposerAtom,
  guiControlComposerOpenAtom,
  openGuiControlAtom,
} from "@src/store/ui/uiAtom";
import { invokeTauri } from "@src/util/platform/tauri";
import { BUILTIN_GUI_CONTROL_DEF_ID } from "@src/util/session/sessionDispatch";

export const GUI_CONTROL_TOGGLE_SHORTCUT_ID = "toggle_gui_control";
export const GUI_CONTROL_SUBMIT_EVENT = "orgii:gui-control-submit";

const GUI_CONTROL_MODE = {
  INPUT: "input",
  SELECTION: "selection",
} as const;

const GUI_CONTROL_AGENT_NAME = "ORGII GUI Control";
const GUI_CONTROL_SESSION_NAME = "Agent Control";
const GUI_CONTROL_AGENT_ICON_ID = "mouse-pointer-click";
const GUI_CONTROL_AGENT_EXEC_MODE: AgentExecMode = "build";
const EMPTY_GUI_CONTROL_EVENTS_ATOM = atom<SessionEvent[]>([]);

type GuiControlMode = (typeof GUI_CONTROL_MODE)[keyof typeof GUI_CONTROL_MODE];
type GuiControlRunStatus = "idle" | "sending" | "running" | "error";

type GuiControlActivityStatus = "running" | "completed" | "failed";

interface GuiControlActivityItem {
  id: string;
  title: string;
  detail: string;
  status: GuiControlActivityStatus;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringRecordValue(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const recordValue = value[key];
  return typeof recordValue === "string" && recordValue.trim().length > 0
    ? recordValue.trim()
    : null;
}

function formatActivityText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatGuiAction(action: string): string {
  return action
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getActivityStatus(event: SessionEvent): GuiControlActivityStatus {
  if (event.displayStatus === "failed") return "failed";
  if (event.displayStatus === "running" || event.isDelta) return "running";
  return "completed";
}

function toGuiControlActivityItem(
  event: SessionEvent
): GuiControlActivityItem | null {
  if (event.source === "user") return null;

  const toolName = event.uiCanonical || event.functionName;
  const status = getActivityStatus(event);

  if (toolName === "control_orgii") {
    const args = isRecord(event.args) ? event.args : {};
    const action = getStringRecordValue(args, "action") ?? "GUI action";
    const summary = extractArgsSummary(toolName, args);
    const resultText = getStringRecordValue(event.result, "content");
    return {
      id: event.id,
      title: formatGuiAction(action),
      detail: formatActivityText(resultText ?? (summary || action)),
      status,
    };
  }

  if (event.source === "assistant" && event.displayText.trim().length > 0) {
    return {
      id: event.id,
      title: "Response",
      detail: formatActivityText(event.displayText),
      status,
    };
  }

  if (
    toolName &&
    toolName !== "agent_message" &&
    event.displayText.trim().length > 0
  ) {
    return {
      id: event.id,
      title: formatGuiAction(toolName),
      detail: formatActivityText(event.displayText),
      status,
    };
  }

  return null;
}

function useGuiControlActivity(
  sessionId: string | null
): GuiControlActivityItem[] {
  const eventsAtom = sessionId
    ? chatEventsForSessionAtomFamily(sessionId)
    : EMPTY_GUI_CONTROL_EVENTS_ATOM;
  const events = useAtomValue(eventsAtom);

  return useMemo(() => {
    if (!sessionId) return [];
    return events
      .map(toGuiControlActivityItem)
      .filter((item): item is GuiControlActivityItem => item !== null)
      .slice(-3)
      .reverse();
  }, [events, sessionId]);
}

function upsertGuiControlSession(result: SessionLaunchResult): void {
  upsertSession({
    session_id: result.sessionId,
    status: result.status,
    created_at: result.createdAt,
    updated_at: result.createdAt,
    user_input: result.userInput || result.name,
    name: result.name,
    branch: result.branch ?? "",
    is_active: true,
    category: DISPATCH_CATEGORY.RUST_AGENT,
    model: result.model,
    agentExecMode: GUI_CONTROL_AGENT_EXEC_MODE,
    agentDefinitionId: BUILTIN_GUI_CONTROL_DEF_ID,
    agentIconId: GUI_CONTROL_AGENT_ICON_ID,
    agentDisplayName: GUI_CONTROL_AGENT_NAME,
    ...(result.accountId ? { accountId: result.accountId } : {}),
    ...(result.background ? { background: true } : {}),
    ...(result.workspacePath ? { repoPath: result.workspacePath } : {}),
    ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
  });
}

export function GuiControlToggle(): React.ReactNode {
  const { t } = useTranslation("common");
  const open = useAtomValue(guiControlComposerOpenAtom);
  const openGuiControl = useSetAtom(openGuiControlAtom);
  const closeGuiControlComposer = useSetAtom(closeGuiControlComposerAtom);
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
  const [controlSessionId, setControlSessionId] = useState<string | null>(null);
  const activityItems = useGuiControlActivity(controlSessionId);

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
    if (!open || showVoiceUi) return;
    const frame = requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, showVoiceUi]);

  const handleSubmit = useCallback(() => {
    const text = composerInputRef.current?.getTextWithPills().trim() ?? "";
    if (!text || sendingRef.current) return;

    openGuiControl();

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
            name: GUI_CONTROL_SESSION_NAME,
            agentDefinitionId: BUILTIN_GUI_CONTROL_DEF_ID,
            keySource: modelConfig.keySource,
            ...(modelConfig.model ? { model: modelConfig.model } : {}),
            ...(modelConfig.accountId
              ? { accountId: modelConfig.accountId }
              : {}),
            ideContext,
          });
          controlSessionIdRef.current = result.sessionId;
          setControlSessionId(result.sessionId);
          upsertGuiControlSession(result);
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
  }, [creatorDefaultLastModel, mode, openGuiControl]);

  const handleClose = useCallback(() => {
    if (voice.isRecording) voice.cancel();
    if (isModelOpen) setSelectorState({ isOpen: false });
    closeGuiControlComposer();
  }, [closeGuiControlComposer, isModelOpen, setSelectorState, voice]);

  const handleRefreshSession = useCallback(() => {
    controlSessionIdRef.current = null;
    setControlSessionId(null);
    setRunStatus("idle");
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, []);

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
    if (!open || !voiceFeatureEnabled) return;
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
  }, [open, voice, voiceFeatureEnabled]);

  if (!open) return null;

  const elevatedShadowClass =
    "!shadow-[0_18px_48px_rgba(0,0,0,0.18)] hover:!shadow-[0_18px_48px_rgba(0,0,0,0.18)] focus-within:!shadow-[0_18px_48px_rgba(0,0,0,0.18)] active:!shadow-[0_18px_48px_rgba(0,0,0,0.18)] dark:!shadow-[0_22px_58px_rgba(0,0,0,0.48)] dark:hover:!shadow-[0_22px_58px_rgba(0,0,0,0.48)] dark:focus-within:!shadow-[0_22px_58px_rgba(0,0,0,0.48)] dark:active:!shadow-[0_22px_58px_rgba(0,0,0,0.48)]";
  const controlModelLabel = resolveControlModelLabel(creatorDefaultLastModel);
  const statusLabel =
    runStatus === "sending"
      ? t("status.sending")
      : runStatus === "error"
        ? t("status.error")
        : t("status.running");
  const showStatusLine = runStatus !== "idle" || Boolean(controlSessionId);
  const latestActivity = activityItems[0];

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center px-6 pb-6 pt-16"
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg-1 via-bg-1/70 to-transparent"
        style={{
          borderBottomLeftRadius: "var(--border-radius-window)",
          borderBottomRightRadius: "var(--border-radius-window)",
        }}
      />
      {showStatusLine && (
        <div
          className="pointer-events-auto z-10 mb-2 rounded-2xl border border-border-2 bg-bg-2 px-3 py-2 text-[12px] text-text-2 shadow-sm backdrop-blur"
          style={{ width: "min(600px, calc(100vw - 48px))" }}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-1 text-primary-6">
              <MousePointerClick size={13} strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5 text-text-1">
                {latestActivity?.status === "running" && (
                  <Loader2
                    size={12}
                    strokeWidth={1.8}
                    className="animate-spin"
                  />
                )}
                {latestActivity?.status === "failed" && (
                  <XCircle size={12} strokeWidth={1.8} />
                )}
                {latestActivity?.status === "completed" && (
                  <CheckCircle2 size={12} strokeWidth={1.8} />
                )}
                <span className="font-medium">
                  {latestActivity?.title ?? statusLabel}
                </span>
              </div>
              <div className="whitespace-normal break-words leading-5">
                {latestActivity?.detail ?? controlModelLabel}
              </div>
            </div>
          </div>
        </div>
      )}
      <ComposerShell
        variant={isCompactRow ? "pill" : "default"}
        className={`pointer-events-auto z-10 ${elevatedShadowClass}`}
        style={{ width: "min(600px, calc(100vw - 48px))" }}
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
                <button
                  type="button"
                  onClick={handleRefreshSession}
                  className={`${INPUT_AREA_BUTTONS.iconButtonBase} shrink-0 leading-none`}
                  style={{ lineHeight: 0 }}
                  aria-label={t("actions.refresh")}
                  title={t("actions.refresh")}
                >
                  <BrushCleaning
                    size={INPUT_AREA_BUTTONS.iconSize}
                    strokeWidth={1.75}
                  />
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
