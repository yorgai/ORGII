/**
 * Connection selection state for the Integrations page.
 * Manages Git provider, channel, and service selection.
 */
import { useCallback, useState } from "react";

import type { DetailMode } from "../types";
import type { useChannelState } from "./useChannelState";

export interface UseConnectionsStateReturn {
  selectedGitProvider: string | null;
  selectedIntegrationKind: "git" | "channel" | null;

  handleGitProviderSelect: (id: string | null, mode?: DetailMode) => void;
  handleGitConnected: () => void;
  handleChannelClick: (compositeId: string | null, mode?: DetailMode) => void;
  clearConnectionsState: () => void;
}

export function useConnectionsState(
  channelState: ReturnType<typeof useChannelState>,
  setDetailMode: (mode: DetailMode) => void
): UseConnectionsStateReturn {
  const [selectedGitProvider, setSelectedGitProvider] = useState<string | null>(
    null
  );
  const [selectedIntegrationKind, setSelectedIntegrationKind] = useState<
    "git" | "channel" | null
  >(null);

  const handleGitProviderSelect = useCallback(
    (id: string | null, mode?: DetailMode) => {
      setSelectedGitProvider(id);
      setSelectedIntegrationKind(id ? "git" : null);
      if (id) {
        channelState.clearSelection();
        setDetailMode(mode ?? "preview");
      }
    },
    [channelState, setDetailMode]
  );

  const handleGitConnected = useCallback(() => {
    void channelState.refreshProjectConnections();
  }, [channelState]);

  const handleChannelClick = useCallback(
    (compositeId: string | null, mode?: DetailMode) => {
      setSelectedGitProvider(null);
      if (!compositeId) {
        setSelectedIntegrationKind(null);
        channelState.clearSelection();
        return;
      }
      setSelectedIntegrationKind("channel");
      setDetailMode(mode ?? "preview");
      channelState.handleChannelClick(compositeId);
    },
    [channelState, setDetailMode]
  );

  const clearConnectionsState = useCallback(() => {
    setSelectedGitProvider(null);
    setSelectedIntegrationKind(null);
    channelState.clearSelection();
  }, [channelState]);

  return {
    selectedGitProvider,
    selectedIntegrationKind,
    handleGitProviderSelect,
    handleGitConnected,
    handleChannelClick,
    clearConnectionsState,
  };
}
