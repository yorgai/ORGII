/**
 * Connection selection state for the Integrations page.
 * Manages Git provider, channel, and service selection.
 */
import { useCallback, useState } from "react";

import type { ServiceType } from "../Connections/Channels";
import type { DetailMode } from "../types";
import type { useChannelState } from "./useChannelState";

interface GitHubHook {
  refresh: () => void;
}

export interface UseConnectionsStateReturn {
  selectedGitProvider: string | null;
  selectedIntegrationKind: "git" | "channel" | "service" | null;
  selectedServiceType: ServiceType | null;

  handleGitProviderSelect: (id: string | null, mode?: DetailMode) => void;
  handleGitConnected: () => void;
  handleChannelClick: (compositeId: string | null, mode?: DetailMode) => void;
  clearConnectionsState: () => void;
}

export function useConnectionsState(
  channelState: ReturnType<typeof useChannelState>,
  github: GitHubHook,
  setDetailMode: (mode: DetailMode) => void
): UseConnectionsStateReturn {
  const [selectedGitProvider, setSelectedGitProvider] = useState<string | null>(
    null
  );
  const [selectedIntegrationKind, setSelectedIntegrationKind] = useState<
    "git" | "channel" | "service" | null
  >(null);
  const [selectedServiceType, setSelectedServiceType] =
    useState<ServiceType | null>(null);

  const handleGitProviderSelect = useCallback(
    (id: string | null, mode?: DetailMode) => {
      setSelectedGitProvider(id);
      setSelectedIntegrationKind(id ? "git" : null);
      setSelectedServiceType(null);
      if (id) {
        channelState.clearSelection();
        setDetailMode(mode ?? "preview");
      }
    },
    [channelState, setDetailMode]
  );

  const handleGitConnected = useCallback(() => {
    github.refresh();
  }, [github]);

  const handleChannelClick = useCallback(
    (compositeId: string | null, mode?: DetailMode) => {
      setSelectedGitProvider(null);
      if (!compositeId) {
        setSelectedIntegrationKind(null);
        setSelectedServiceType(null);
        channelState.clearSelection();
        return;
      }
      setSelectedIntegrationKind("channel");
      setSelectedServiceType(null);
      setDetailMode(mode ?? "preview");
      channelState.handleChannelClick(compositeId);
    },
    [channelState, setDetailMode]
  );

  const clearConnectionsState = useCallback(() => {
    setSelectedGitProvider(null);
    setSelectedIntegrationKind(null);
    setSelectedServiceType(null);
    channelState.clearSelection();
  }, [channelState]);

  return {
    selectedGitProvider,
    selectedIntegrationKind,
    selectedServiceType,
    handleGitProviderSelect,
    handleGitConnected,
    handleChannelClick,
    clearConnectionsState,
  };
}
