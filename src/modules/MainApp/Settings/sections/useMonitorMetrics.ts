/**
 * useMonitorMetrics
 *
 * Encapsulates data fetching, state, and polling lifecycle for MonitorSection.
 * Polls system/process metrics via Tauri invoke commands while the section is
 * visible and the document is in the foreground.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useRamHistory } from "@src/hooks/perf";
import {
  monitorActiveTabAtom,
  monitorRefreshTriggerAtom,
  monitorScanningAtom,
  networkRefreshTriggerAtom,
  storageRefreshTriggerAtom,
} from "@src/store";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProcessMetrics {
  memory_rss_mb: number;
  memory_virtual_mb: number;
  cpu_percent: number;
  start_time_secs: number;
  uptime_secs: number;
  pid: number;
  name: string;
}

export interface SystemMemoryMetrics {
  total_mb: number;
  used_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_used_mb: number;
}

export interface MemoryBreakdown {
  backend_rss_mb: number;
  tracked_backend_mb: number;
  file_cache_mb: number;
}

export interface ChildProcessInfo {
  pid: number;
  name: string;
  memory_mb: number;
  category: string;
}

export interface SystemInfo {
  os_name: string;
  os_version: string;
  chip_type: string;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

export interface BreakdownRow {
  key: string;
  label: string;
  megabytes: number;
  totalMb: number;
}

export function formatMemory(megabytes: number): string {
  if (megabytes >= 1024) return (megabytes / 1024).toFixed(2) + " GB";
  return megabytes.toFixed(1) + " MB";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const METRICS_POLL_INTERVAL_MS = 5000;

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface UseMonitorMetricsReturn {
  processMetrics: ProcessMetrics | null;
  systemMemory: SystemMemoryMetrics | null;
  memoryBreakdown: MemoryBreakdown | null;
  childProcesses: ChildProcessInfo[];
  systemInfo: SystemInfo | null;
  ramHistory: ReturnType<typeof useRamHistory>["stats"];
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useMonitorMetrics(activeTab: string): UseMonitorMetricsReturn {
  const [processMetrics, setProcessMetrics] = useState<ProcessMetrics | null>(
    null
  );
  const [systemMemory, setSystemMemory] = useState<SystemMemoryMetrics | null>(
    null
  );
  const [memoryBreakdown, setMemoryBreakdown] =
    useState<MemoryBreakdown | null>(null);
  const [childProcesses, setChildProcesses] = useState<ChildProcessInfo[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  const setMonitorActiveTab = useSetAtom(monitorActiveTabAtom);
  const setScanning = useSetAtom(monitorScanningAtom);
  const setNetworkTrigger = useSetAtom(networkRefreshTriggerAtom);
  const setStorageTrigger = useSetAtom(storageRefreshTriggerAtom);
  const monitorRefreshTrigger = useAtomValue(monitorRefreshTriggerAtom);

  const { stats: ramHistory, recordSample: recordRamSample } = useRamHistory();

  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef(false);

  useEffect(() => {
    setMonitorActiveTab(activeTab);
  }, [activeTab, setMonitorActiveTab]);

  const fetchMetrics = useCallback(async () => {
    try {
      const [process, system, breakdown, children, sysInfo] = await Promise.all(
        [
          invoke<ProcessMetrics>("get_process_metrics"),
          invoke<SystemMemoryMetrics>("get_system_memory"),
          invoke<MemoryBreakdown>("get_memory_breakdown").catch(() => null),
          invoke<ChildProcessInfo[]>("get_child_processes_memory").catch(
            () => []
          ),
          invoke<SystemInfo>("get_system_info").catch(() => null),
        ]
      );
      setProcessMetrics(process);
      setSystemMemory(system);
      setMemoryBreakdown(breakdown);
      setChildProcesses(children);
      if (sysInfo) setSystemInfo(sysInfo);

      const childTotal = children.reduce(
        (sum, child) => sum + child.memory_mb,
        0
      );
      recordRamSample((process.memory_rss_mb ?? 0) + childTotal);
    } catch (error) {
      console.error("[Monitor] Failed to fetch metrics:", error);
    }
  }, [recordRamSample]);

  const handleRefresh = useCallback(
    async (onSuccess?: () => void) => {
      setScanning(true);
      try {
        await fetchMetrics();
        onSuccess?.();
      } finally {
        setScanning(false);
      }
    },
    [fetchMetrics, setScanning]
  );

  useEffect(() => {
    if (monitorRefreshTrigger <= 0) return;
    if (activeTab === "resources") {
      void handleRefresh();
    } else if (activeTab === "network") {
      setNetworkTrigger((prev) => prev + 1);
    } else if (activeTab === "storage") {
      setStorageTrigger((prev) => prev + 1);
    }
  }, [
    monitorRefreshTrigger,
    activeTab,
    handleRefresh,
    setNetworkTrigger,
    setStorageTrigger,
  ]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(fetchMetrics, METRICS_POLL_INTERVAL_MS);
  }, [fetchMetrics]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isVisibleRef.current) {
        void fetchMetrics();
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchMetrics, startPolling, stopPolling]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting && document.visibilityState === "visible") {
          void fetchMetrics();
          startPolling();
        } else {
          stopPolling();
        }
      },
      { threshold: 0 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stopPolling();
    };
  }, [fetchMetrics, startPolling, stopPolling]);

  return {
    processMetrics,
    systemMemory,
    memoryBreakdown,
    childProcesses,
    systemInfo,
    ramHistory,
    containerRef,
  };
}
