/**
 * useOSAgentGateway Hook
 *
 * Manages gateway status polling and start/stop actions.
 * Polls every 10s when loaded so live connection status stays fresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getGatewayStatus,
  startGateway,
  stopGateway,
} from "@src/api/tauri/agent";

import type { GatewayStatusInfo } from "./types";

const POLL_INTERVAL_MS = 10_000;

export interface UseOSAgentGatewayReturn {
  gatewayStatus: GatewayStatusInfo | null;
  gatewayLoading: boolean;
  refreshGatewayStatus: () => void;
  handleStartGateway: () => Promise<void>;
  handleStopGateway: () => Promise<void>;
}

export function useOSAgentGateway(loaded: boolean): UseOSAgentGatewayReturn {
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusInfo | null>(
    null
  );
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshGatewayStatus = useCallback(() => {
    getGatewayStatus()
      .then((status) =>
        setGatewayStatus(status as unknown as GatewayStatusInfo)
      )
      .catch((err) => {
        console.warn("Failed to fetch OS agent gateway status:", err);
        setGatewayStatus(null);
      });
  }, []);

  useEffect(() => {
    if (!loaded) return;

    refreshGatewayStatus();
    pollRef.current = setInterval(refreshGatewayStatus, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loaded, refreshGatewayStatus]);

  const handleStartGateway = useCallback(async () => {
    setGatewayLoading(true);
    try {
      await startGateway();
      refreshGatewayStatus();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[OSAgent] Failed to start gateway:", errMsg); // eslint-disable-line no-console
      alert(`Gateway start failed:\n${errMsg}`);
    } finally {
      setGatewayLoading(false);
    }
  }, [refreshGatewayStatus]);

  const handleStopGateway = useCallback(async () => {
    setGatewayLoading(true);
    try {
      await stopGateway();
      refreshGatewayStatus();
    } catch (err: unknown) {
      console.error("[OSAgent] Failed to stop gateway:", err);
    } finally {
      setGatewayLoading(false);
    }
  }, [refreshGatewayStatus]);

  return {
    gatewayStatus,
    gatewayLoading,
    refreshGatewayStatus,
    handleStartGateway,
    handleStopGateway,
  };
}
