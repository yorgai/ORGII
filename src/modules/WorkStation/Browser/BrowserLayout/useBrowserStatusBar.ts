/**
 * useBrowserStatusBar
 *
 * Syncs browser state into the global StatusBar atoms when the
 * Browser layout is active.  Separated from useBrowserLayoutState to keep
 * the main hook under the 600-line limit.
 */
import { useSetAtom } from "jotai";
import { useEffect } from "react";

import { useMounted } from "@src/hooks/lifecycle/useMounted";
import type { ElementInfo } from "@src/modules/WorkStation/Browser/hooks/useWebviewInspector";
import {
  browserStatusBarCallbacksAtom,
  browserStatusBarStateAtom,
} from "@src/store/ui/workStationAtom";

import {
  buildSelectedElementLabel,
  buildSelectedElementText,
} from "./browserLayoutUtils";

interface BrowserStatusBarSyncOptions {
  isActive: boolean;
  currentUrl: string;
  isLoading: boolean;
  errorCount: number;
  warningCount: number;
  devToolsCollapsed: boolean;
  isPrivate: boolean;
  sessionCount: number;
  currentSessionIndex: number;
  selectedElement: ElementInfo | null;
  primarySidebarCollapsed: boolean;
  togglePrimarySidebar: () => void;
  handleToggleDevTools: () => void;
  handlePrevSession: () => void;
  handleNextSession: () => void;
  clearSelection: () => void;
  setAddToAgent: (payload: {
    type: "dom-element";
    text: string;
    displayName: string;
  }) => void;
  toastSuccess: (msg: string) => void;
  chatSentToastMessage: string;
}

export function useBrowserStatusBar({
  isActive,
  currentUrl,
  isLoading,
  errorCount,
  warningCount,
  devToolsCollapsed,
  isPrivate,
  sessionCount,
  currentSessionIndex,
  selectedElement,
  primarySidebarCollapsed,
  togglePrimarySidebar,
  handleToggleDevTools,
  handlePrevSession,
  handleNextSession,
  clearSelection,
  setAddToAgent,
  toastSuccess,
  chatSentToastMessage,
}: BrowserStatusBarSyncOptions): void {
  const setGlobalStatusBarState = useSetAtom(browserStatusBarStateAtom);
  const setStatusBarCallbacks = useSetAtom(browserStatusBarCallbacksAtom);
  const isMountedRef = useMounted();

  const selectedElementLabel = selectedElement
    ? buildSelectedElementLabel(selectedElement)
    : undefined;
  const hasSelectedElement = selectedElement != null;

  useEffect(() => {
    if (!isActive) return;
    setGlobalStatusBarState((prev) => ({
      ...prev,
      appType: "browser" as const,
      browserUrl: currentUrl,
      browserIsLoading: isLoading,
      browserErrorCount: errorCount,
      browserWarningCount: warningCount,
      browserIsDevToolsOpen: !devToolsCollapsed,
      browserIsPrivate: isPrivate,
      browserSessionCount: sessionCount,
      browserCurrentSessionIndex: currentSessionIndex,
      browserHasSelectedElement: hasSelectedElement,
      browserSelectedElementLabel: selectedElementLabel,
    }));
  }, [
    isActive,
    currentUrl,
    isLoading,
    errorCount,
    warningCount,
    devToolsCollapsed,
    isPrivate,
    sessionCount,
    currentSessionIndex,
    hasSelectedElement,
    selectedElementLabel,
    setGlobalStatusBarState,
  ]);

  useEffect(() => {
    if (!isActive) return;
    const handleSendSelectedElementToChat = () => {
      if (!selectedElement) return;
      const label = buildSelectedElementLabel(selectedElement);
      const text = buildSelectedElementText(selectedElement, currentUrl);
      setAddToAgent({ type: "dom-element", text, displayName: label });
      toastSuccess(chatSentToastMessage);
    };

    setStatusBarCallbacks((prev) => ({
      ...prev,
      primaryPanelCollapsed: primarySidebarCollapsed,
      onTogglePrimaryPanel: togglePrimarySidebar,
      onToggleDevTools: handleToggleDevTools,
      devToolsOpen: !devToolsCollapsed,
      onPrevSession: handlePrevSession,
      onNextSession: handleNextSession,
      onSendSelectedElementToChat: handleSendSelectedElementToChat,
      onClearSelectedElement: () => {
        void clearSelection();
      },
    }));
    const ref = isMountedRef;
    return () => {
      if (ref.current) return;
      setStatusBarCallbacks({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isActive,
    primarySidebarCollapsed,
    togglePrimarySidebar,
    handleToggleDevTools,
    devToolsCollapsed,
    handlePrevSession,
    handleNextSession,
    clearSelection,
    setStatusBarCallbacks,
    selectedElement,
    currentUrl,
    setAddToAgent,
    toastSuccess,
    chatSentToastMessage,
  ]);
}
