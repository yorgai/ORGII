import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { getTerminalBufferCacheStats } from "@src/components/TerminalInteractive/bufferCache";
import { createLogger } from "@src/hooks/logger";
import {
  collectWebViewRuntimeDiagnostics,
  useRuntimeRamStats,
} from "@src/hooks/perf";

import { EMPTY_SNAPSHOT, METRICS_POLL_INTERVAL_MS } from "./constants";
import type {
  ChildProcessInfo,
  MemoryBreakdown,
  MetricsSnapshot,
  ProcessMetrics,
  PtyMemoryInfo,
  SystemMemoryMetrics,
} from "./types";

const logger = createLogger("SidebarRamMonitor");

export function useRamMonitorMetrics(isOpen: boolean) {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot>(EMPTY_SNAPSHOT);
  const {
    rows: runtimeRows,
    fpsSample,
    fpsValue,
    isSamplingFps,
    refresh: refreshRuntimeStats,
  } = useRuntimeRamStats(false);

  const fetchMetrics = useCallback(async () => {
    if (document.visibilityState !== "visible") return;

    try {
      const [
        processMetrics,
        systemMemory,
        memoryBreakdown,
        childProcesses,
        ptyMemory,
      ] = await Promise.all([
        invoke<ProcessMetrics>("get_process_metrics"),
        invoke<SystemMemoryMetrics>("get_system_memory"),
        invoke<MemoryBreakdown>("get_memory_breakdown"),
        invoke<ChildProcessInfo[]>("get_child_processes_memory"),
        invoke<PtyMemoryInfo[]>("get_pty_memory_usage").catch(() => []),
      ]);
      const terminalBufferStats = getTerminalBufferCacheStats();
      const webViewDiagnostics = collectWebViewRuntimeDiagnostics();

      setSnapshot({
        processMetrics,
        systemMemory,
        memoryBreakdown,
        childProcesses,
        ptyMemory,
        webViewDiagnostics,
        terminalBufferBytes: terminalBufferStats.bytes,
        terminalBufferEntries: terminalBufferStats.entries,
        lastUpdatedAt: Date.now(),
        errorMessage: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn("failed to fetch sidebar RAM metrics", error);
      setSnapshot((previousSnapshot) => ({
        ...previousSnapshot,
        errorMessage,
      }));
    }
  }, []);

  const refreshAll = useCallback(() => {
    refreshRuntimeStats();
    void fetchMetrics();
  }, [fetchMetrics, refreshRuntimeStats]);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = window.requestAnimationFrame(refreshAll);
    const intervalId = window.setInterval(refreshAll, METRICS_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAll();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isOpen, refreshAll]);

  return {
    snapshot,
    runtimeRows,
    fpsSample,
    fpsValue,
    isSamplingFps,
  };
}
