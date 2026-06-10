import { useAtomValue, useSetAtom } from "jotai";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  DraftingCompass,
  Loader2,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { sessionLaunch } from "@src/api/tauri/agent/session";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import Message from "@src/components/Message";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import type { AdeSessionProposalDetail } from "@src/modules/WorkStation/ActionSystem/registration/actions/sessionActions.zod";
import { ADE_SESSION_PROPOSAL_EVENT } from "@src/modules/WorkStation/ActionSystem/registration/actions/sessionActions.zod";
import type { SpotlightItem } from "@src/scaffold/GlobalSpotlight/types";
import { collectIdeContext } from "@src/services/context/collectors";
import { adeManagerPaletteAtom } from "@src/store/session/adeManagerPaletteAtom";
import {
  creatorDefaultModelSelectionAtom,
  extractModelPair,
} from "@src/store/session/creatorDefaultModelAtom";
import { modelSelectorAtom } from "@src/store/ui/modelSelectorAtom";
import { guiControlEnabledAtom } from "@src/store/ui/uiAtom";
import { invokeTauri } from "@src/util/platform/tauri";
import { BUILTIN_ADE_MANAGER_DEF_ID } from "@src/util/session/sessionDispatch";

import { useSelectorKernel } from "../core";
import {
  GUI_CONTROL_SESSION_NAME,
  GUI_CONTROL_SUBMIT_EVENT,
  GUI_CONTROL_TOGGLE_SHORTCUT_ID,
} from "./constants";
import type {
  GuiControlActivityItem,
  GuiControlRunStatus,
  GuiControlSubmitDetail,
} from "./types";
import {
  EMPTY_GUI_CONTROL_EVENTS_ATOM,
  buildControlPrompt,
  resolveControlModel,
  resolveControlModelLabel,
  toGuiControlActivityItem,
  upsertGuiControlSession,
} from "./utils";

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

export function useAgentControlPalette({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("common");
  const creatorDefaultLastModel = useValidatedLastPair();
  const setCreatorDefaultModel = useSetAtom(creatorDefaultModelSelectionAtom);
  const setGuiControlEnabled = useSetAtom(guiControlEnabledAtom);
  const setSelectorState = useSetAtom(modelSelectorAtom);

  // Persistent palette state — survives palette open/close cycles
  const paletteState = useAtomValue(adeManagerPaletteAtom);
  const setPaletteState = useSetAtom(adeManagerPaletteAtom);

  const {
    sessionId: controlSessionId,
    draftText,
    runStatus,
    activityCursor,
    pendingProposal,
  } = paletteState;

  const setDraftText = useCallback(
    (text: string) => setPaletteState((prev) => ({ ...prev, draftText: text })),
    [setPaletteState]
  );
  const setRunStatus = useCallback(
    (status: GuiControlRunStatus) =>
      setPaletteState((prev) => ({ ...prev, runStatus: status })),
    [setPaletteState]
  );
  const setControlSessionId = useCallback(
    (id: string | null) =>
      setPaletteState((prev) => ({ ...prev, sessionId: id })),
    [setPaletteState]
  );
  const setActivityCursor = useCallback(
    (cursor: number | ((prev: number) => number)) =>
      setPaletteState((prev) => ({
        ...prev,
        activityCursor:
          typeof cursor === "function" ? cursor(prev.activityCursor) : cursor,
      })),
    [setPaletteState]
  );
  const setPendingProposal = useCallback(
    (proposal: AdeSessionProposalDetail | null) =>
      setPaletteState((prev) => ({ ...prev, pendingProposal: proposal })),
    [setPaletteState]
  );

  // Keep a ref in sync with atom so async callbacks always see fresh value
  const controlSessionIdRef = useRef<string | null>(controlSessionId);
  useEffect(() => {
    controlSessionIdRef.current = controlSessionId;
  }, [controlSessionId]);

  const sendingRef = useRef(false);
  const activityItems = useGuiControlActivity(controlSessionId);

  // Listen for session proposals emitted by session.propose Zod action
  useEffect(() => {
    function handleProposal(evt: Event) {
      const detail = (evt as CustomEvent<AdeSessionProposalDetail>).detail;
      if (!detail?.correlationId) return;
      setPendingProposal(detail);
    }
    window.addEventListener(ADE_SESSION_PROPOSAL_EVENT, handleProposal);
    return () => {
      window.removeEventListener(ADE_SESSION_PROPOSAL_EVENT, handleProposal);
    };
  }, [setPendingProposal]);

  const handleDismissProposal = useCallback(() => {
    setPendingProposal(null);
  }, [setPendingProposal]);

  const items = useMemo<SpotlightItem[]>(() => [], []);

  const handleSubmit = useCallback(() => {
    const text = draftText.trim();
    if (!text || sendingRef.current) return;

    setGuiControlEnabled(true);
    const prompt = buildControlPrompt(text);
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
            agentDefinitionId: BUILTIN_ADE_MANAGER_DEF_ID,
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
            detail: { text, modelSelection: creatorDefaultLastModel },
          })
        );

        setDraftText("");
      } catch (error) {
        setRunStatus("error");
        Message.error(error instanceof Error ? error.message : String(error));
      } finally {
        sendingRef.current = false;
      }
    })();
  }, [
    creatorDefaultLastModel,
    draftText,
    setControlSessionId,
    setDraftText,
    setGuiControlEnabled,
    setRunStatus,
  ]);

  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internalHandleKeyDown: (
        event: React.KeyboardEvent<HTMLInputElement>
      ) => void
    ) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        handleSubmit();
        return;
      }
      internalHandleKeyDown(event);
    },
    [handleSubmit]
  );

  const kernel = useSelectorKernel({
    isOpen,
    onClose,
    items,
    externalSearchQuery: draftText,
    externalSetSearchQuery: setDraftText,
    externalHandleKeyDown: handleExternalKeyDown,
    initialSelectedIndex: -1,
  });

  useEffect(() => {
    setActivityCursor(0);
  }, [activityItems.length, setActivityCursor]);

  const handleRefreshSession = useCallback(() => {
    controlSessionIdRef.current = null;
    setControlSessionId(null);
    setActivityCursor(0);
    setRunStatus("idle");
    kernel.focusInput();
  }, [kernel, setActivityCursor, setControlSessionId, setRunStatus]);

  const handlePreviousActivity = useCallback(() => {
    setActivityCursor((currentCursor) =>
      Math.min(currentCursor + 1, Math.max(activityItems.length - 1, 0))
    );
  }, [activityItems.length, setActivityCursor]);

  const handleNextActivity = useCallback(() => {
    setActivityCursor((currentCursor) => Math.max(currentCursor - 1, 0));
  }, [setActivityCursor]);

  const handleLatestActivity = useCallback(() => {
    setActivityCursor(0);
  }, [setActivityCursor]);

  const handleModelConfigChange = useCallback(
    (config: AdvancedConfig) => {
      setCreatorDefaultModel(extractModelPair(config));
      setSelectorState({ isOpen: false });
      kernel.focusInput();
    },
    [kernel, setCreatorDefaultModel, setSelectorState]
  );

  const handleCloseModelSelector = useCallback(() => {
    setSelectorState({ isOpen: false });
    kernel.focusInput();
  }, [kernel, setSelectorState]);

  const modePath = useMemo(
    () => [
      {
        type: "action" as const,
        id: "agent-control",
        label: "ADE Manager",
        icon: DraftingCompass,
        color: "",
      },
    ],
    []
  );

  const latestActivity = activityItems[activityCursor];
  const statusLabel =
    runStatus === "sending"
      ? t("status.sending")
      : runStatus === "error"
        ? t("status.error")
        : t("status.running");

  const statusIcon =
    latestActivity?.status === "running" ||
    (!latestActivity && runStatus === "sending")
      ? Loader2
      : latestActivity?.status === "failed" || runStatus === "error"
        ? XCircle
        : CheckCircle2;

  return {
    activityItems,
    creatorDefaultLastModel,
    draftText,
    handleCloseModelSelector,
    handleDismissProposal,
    handleLatestActivity,
    handleModelConfigChange,
    handleNextActivity,
    handlePreviousActivity,
    handleRefreshSession,
    handleSubmit,
    hasNextActivity: activityCursor > 0,
    hasPreviousActivity: activityCursor < activityItems.length - 1,
    isModelOpen: false,
    items,
    kernel,
    modePath,
    pendingProposal,
    placeholder: t("guiControl.inputPlaceholder"),
    runStatus,
    selectModelLabel: t("guiControl.selectModel"),
    shortcutId: GUI_CONTROL_TOGGLE_SHORTCUT_ID,
    statusDetail:
      latestActivity?.detail ??
      resolveControlModelLabel(creatorDefaultLastModel),
    statusIcon,
    statusIsMarkdown: latestActivity?.isMarkdown ?? false,
    statusLabel: latestActivity?.title ?? statusLabel,
    statusSpinning:
      latestActivity?.status === "running" ||
      (!latestActivity && runStatus === "sending"),
    showSessionControls: Boolean(controlSessionId),
    showStatusLine: runStatus !== "idle" || Boolean(controlSessionId),
    submitDisabled: !draftText.trim(),
    toolbarActions: {
      previousIcon: ChevronLeft,
      nextIcon: ChevronRight,
      latestIcon: ChevronsRight,
    },
  };
}
