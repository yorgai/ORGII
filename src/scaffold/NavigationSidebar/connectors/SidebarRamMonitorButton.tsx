import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronUp, Gauge } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import LiquidGlassHoverItem from "@src/components/LiquidGlassHoverItem";
import { getTerminalBufferCacheStats } from "@src/components/TerminalInteractive/bufferCache";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { createLogger } from "@src/hooks/logger";
import {
  type WebViewRuntimeDiagnostics,
  collectWebViewRuntimeDiagnostics,
  formatRuntimeBytes,
  useRuntimeRamStats,
} from "@src/hooks/perf";

import HoverAnimatedIcon, {
  triggerIconAnimation,
} from "../components/HoverAnimatedIcon";

const logger = createLogger("SidebarRamMonitor");

const METRICS_POLL_INTERVAL_MS = 5000;
const MAX_CHILD_PROCESS_ROWS = 4;
const SUCCESS_FPS_THRESHOLD = 40;
const SUCCESS_RAM_THRESHOLD_MB = 1024;
const CHILD_PROCESS_CATEGORY = {
  TERMINAL: "terminal",
  WEBVIEW: "webview",
  GPU: "gpu",
  NETWORK: "network",
  OTHER: "other",
} as const;

type ChildProcessCategory =
  (typeof CHILD_PROCESS_CATEGORY)[keyof typeof CHILD_PROCESS_CATEGORY];

interface ProcessMetrics {
  memory_rss_mb: number;
  memory_virtual_mb: number;
  cpu_percent: number;
  start_time_secs: number;
  uptime_secs: number;
  pid: number;
  name: string;
}

interface SystemMemoryMetrics {
  total_mb: number;
  used_mb: number;
  available_mb: number;
  swap_total_mb: number;
  swap_used_mb: number;
}

interface ChildProcessInfo {
  pid: number;
  parent_pid?: number | null;
  name: string;
  memory_mb: number;
  virtual_memory_mb?: number;
  category: ChildProcessCategory | string;
  depth?: number;
}

interface PtyMemoryInfo {
  session_id: string;
  pid?: number | null;
  shell: string;
  memory_mb: number;
  buffer_bytes: number;
  scrollback_lines: number;
}

interface MemoryBreakdown {
  backend_rss_mb: number;
  tracked_backend_mb: number;
  file_cache_mb: number;
}

interface MetricsSnapshot {
  processMetrics: ProcessMetrics | null;
  systemMemory: SystemMemoryMetrics | null;
  memoryBreakdown: MemoryBreakdown | null;
  childProcesses: ChildProcessInfo[];
  ptyMemory: PtyMemoryInfo[];
  webViewDiagnostics: WebViewRuntimeDiagnostics | null;
  terminalBufferBytes: number;
  terminalBufferEntries: number;
  lastUpdatedAt: number | null;
  errorMessage: string | null;
}

interface MemoryStatRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasized?: boolean;
  tone?: "success" | "muted";
  indentLevel?: number;
}

interface MemoryBreakdownRow {
  key: string;
  label: React.ReactNode;
  value: string;
  bytes: number;
  detail?: string;
  emphasized?: boolean;
  indentLevel?: number;
}

const EMPTY_SNAPSHOT: MetricsSnapshot = {
  processMetrics: null,
  systemMemory: null,
  memoryBreakdown: null,
  childProcesses: [],
  ptyMemory: [],
  webViewDiagnostics: null,
  terminalBufferBytes: 0,
  terminalBufferEntries: 0,
  lastUpdatedAt: null,
  errorMessage: null,
};

function formatMegabytes(megabytes: number): string {
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(1)} MB`;
}

function getProcessMemoryTotal(snapshot: MetricsSnapshot): number {
  const appMemoryMb = snapshot.processMetrics?.memory_rss_mb ?? 0;
  const childMemoryMb = snapshot.childProcesses.reduce(
    (sum, childProcess) => sum + childProcess.memory_mb,
    0
  );
  return appMemoryMb + childMemoryMb;
}

function formatChildProcessLabel(childProcess: ChildProcessInfo): string {
  const parentPid = childProcess.parent_pid
    ? ` ppid:${childProcess.parent_pid}`
    : "";
  const depth = childProcess.depth ? ` d:${childProcess.depth}` : "";
  return `${childProcess.name} · pid:${childProcess.pid}${parentPid}${depth}`;
}

function isFrontendWebKitProcess(childProcess: ChildProcessInfo): boolean {
  return (
    childProcess.category === CHILD_PROCESS_CATEGORY.WEBVIEW ||
    childProcess.category === CHILD_PROCESS_CATEGORY.GPU ||
    childProcess.category === CHILD_PROCESS_CATEGORY.NETWORK
  );
}

const MemoryStatRow: React.FC<MemoryStatRowProps> = ({
  label,
  value,
  emphasized = false,
  tone,
  indentLevel = 0,
}) => {
  const textWeightClassName = emphasized ? "font-semibold" : "font-normal";
  const indentClassName =
    indentLevel === 1 ? "pl-3" : indentLevel === 2 ? "pl-6" : "";
  const valueToneClassName =
    tone === "success"
      ? "text-success-6"
      : tone === "muted"
        ? "text-text-2"
        : "text-text-1";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className={`min-w-0 ${indentClassName}`}>
        <div
          className={`truncate text-[12px] leading-[1.35] text-text-1 ${textWeightClassName}`}
        >
          {label}
        </div>
      </div>
      <div
        className={`shrink-0 text-right text-[12px] ${valueToneClassName} ${textWeightClassName}`}
      >
        {value}
      </div>
    </div>
  );
};

export const SidebarRamMonitorButton: React.FC = React.memo(() => {
  const { t: tSettings } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<MetricsSnapshot>(EMPTY_SNAPSHOT);
  const [showAttributionHints, setShowAttributionHints] = useState(false);
  const {
    rows: runtimeRows,
    fpsSample,
    fpsValue,
    isSamplingFps,
    refresh: refreshRuntimeStats,
  } = useRuntimeRamStats(false);
  const { isOpen, isPositioned, toggle, triggerRef, panelRef, panelPosition } =
    useDropdownEngine<HTMLDivElement>({
      placement: "top",
      align: "right",
      gap: DROPDOWN_PANEL.triggerGap,
    });

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

  const handleToggleAttributionHints = useCallback(() => {
    setShowAttributionHints((previousValue) => !previousValue);
  }, []);

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

  const appMemoryMb = snapshot.processMetrics?.memory_rss_mb ?? 0;
  const backendRssMb = snapshot.memoryBreakdown?.backend_rss_mb ?? appMemoryMb;
  const fileCacheMb = snapshot.memoryBreakdown?.file_cache_mb ?? 0;
  const totalMemoryMb = getProcessMemoryTotal(snapshot);
  const terminalPtyBufferBytes = snapshot.ptyMemory.reduce(
    (sum, ptyInfo) => sum + ptyInfo.buffer_bytes,
    0
  );
  const totalTerminalBufferBytes =
    snapshot.terminalBufferBytes + terminalPtyBufferBytes;
  const tauriWebViewRendererMemoryMb = snapshot.childProcesses
    .filter(
      (childProcess) => childProcess.category === CHILD_PROCESS_CATEGORY.WEBVIEW
    )
    .reduce((sum, childProcess) => sum + childProcess.memory_mb, 0);
  const tauriGpuMemoryMb = snapshot.childProcesses
    .filter(
      (childProcess) => childProcess.category === CHILD_PROCESS_CATEGORY.GPU
    )
    .reduce((sum, childProcess) => sum + childProcess.memory_mb, 0);
  const tauriNetworkMemoryMb = snapshot.childProcesses
    .filter(
      (childProcess) => childProcess.category === CHILD_PROCESS_CATEGORY.NETWORK
    )
    .reduce((sum, childProcess) => sum + childProcess.memory_mb, 0);
  const frontendProcessMemoryMb =
    tauriWebViewRendererMemoryMb + tauriGpuMemoryMb + tauriNetworkMemoryMb;
  const webViewDiagnostics = snapshot.webViewDiagnostics;
  const webViewEstimateBytes =
    (webViewDiagnostics?.decodedImageBytes ?? 0) +
    (webViewDiagnostics?.dataUrlBytes ?? 0) +
    (webViewDiagnostics?.canvasBytes ?? 0) +
    (webViewDiagnostics?.videoFrameBytes ?? 0);
  const runtimeEstimateBytes =
    totalTerminalBufferBytes +
    runtimeRows.reduce((sum, row) => sum + row.bytes, 0);
  const attributionHintBytes = webViewEstimateBytes + runtimeEstimateBytes;
  const topChildProcesses = snapshot.childProcesses
    .filter(
      (childProcess) =>
        childProcess.memory_mb > 0 && !isFrontendWebKitProcess(childProcess)
    )
    .slice(0, MAX_CHILD_PROCESS_ROWS);
  const otherProcessMemoryMb = topChildProcesses.reduce(
    (sum, childProcess) => sum + childProcess.memory_mb,
    0
  );
  const ramBreakdownRows: MemoryBreakdownRow[] = [
    {
      key: "backendGroup",
      label: tSettings("monitor.backendGroup"),
      value: formatMegabytes(backendRssMb),
      bytes: backendRssMb * 1024 * 1024,
    },
    {
      key: "backendFileCache",
      label: tSettings("monitor.backendFileCache"),
      value: formatMegabytes(fileCacheMb),
      bytes: fileCacheMb * 1024 * 1024,
      indentLevel: 1,
    },
    {
      key: "frontendGroup",
      label: tSettings("monitor.frontendRssGroup"),
      value: formatMegabytes(frontendProcessMemoryMb),
      bytes: frontendProcessMemoryMb * 1024 * 1024,
    },
    {
      key: "otherProcessesGroup",
      label: tSettings("monitor.otherProcessesGroup"),
      value: formatMegabytes(otherProcessMemoryMb),
      bytes: otherProcessMemoryMb * 1024 * 1024,
    },
    ...topChildProcesses.map((childProcess) => ({
      key: `child-${childProcess.pid}`,
      label: formatChildProcessLabel(childProcess),
      value: formatMegabytes(childProcess.memory_mb),
      bytes: childProcess.memory_mb * 1024 * 1024,
      indentLevel: 1,
    })),
    {
      key: "attributionHintsGroup",
      label: tSettings("monitor.attributionHintsGroup"),
      value: formatRuntimeBytes(attributionHintBytes),
      bytes: attributionHintBytes,
    },
    {
      key: "webViewEstimatesGroup",
      label: tSettings("monitor.webViewEstimatesGroup"),
      value: formatRuntimeBytes(webViewEstimateBytes),
      bytes: webViewEstimateBytes,
    },
    {
      key: "webViewDecodedImages",
      label: tSettings("monitor.webViewDecodedImages", {
        count: webViewDiagnostics?.imageCount ?? 0,
      }),
      value: formatRuntimeBytes(webViewDiagnostics?.decodedImageBytes ?? 0),
      bytes: webViewDiagnostics?.decodedImageBytes ?? 0,
      indentLevel: 1,
    },
    {
      key: "webViewDataUrlImages",
      label: tSettings("monitor.webViewDataUrlImages", {
        count: webViewDiagnostics?.dataUrlImageCount ?? 0,
      }),
      value: formatRuntimeBytes(webViewDiagnostics?.dataUrlBytes ?? 0),
      bytes: webViewDiagnostics?.dataUrlBytes ?? 0,
      indentLevel: 1,
    },
    {
      key: "webViewCanvasSurfaces",
      label: tSettings("monitor.webViewCanvasSurfaces", {
        count: webViewDiagnostics?.canvasCount ?? 0,
      }),
      value: formatRuntimeBytes(webViewDiagnostics?.canvasBytes ?? 0),
      bytes: webViewDiagnostics?.canvasBytes ?? 0,
      indentLevel: 1,
    },
    {
      key: "webViewVideoFrames",
      label: tSettings("monitor.webViewVideoFrames", {
        count: webViewDiagnostics?.videoCount ?? 0,
      }),
      value: formatRuntimeBytes(webViewDiagnostics?.videoFrameBytes ?? 0),
      bytes: webViewDiagnostics?.videoFrameBytes ?? 0,
      indentLevel: 1,
    },
    {
      key: "runtimeEstimatesGroup",
      label: tSettings("monitor.runtimeEstimatesGroup"),
      value: formatRuntimeBytes(runtimeEstimateBytes),
      bytes: runtimeEstimateBytes,
    },
    ...runtimeRows.map((row) => ({ ...row, indentLevel: 1 })),
    {
      key: "terminalBuffers",
      label: tSettings("monitor.terminalBuffers"),
      value: formatRuntimeBytes(totalTerminalBufferBytes),
      bytes: totalTerminalBufferBytes,
      indentLevel: 1,
    },
  ];
  const visibleRamBreakdownRows = ramBreakdownRows.filter(
    (row) => row.bytes > 0
  );
  const buttonActiveClassName = isOpen ? "text-text-1" : "text-text-2";
  const triggerTitle = tSettings("monitor.performanceMonitor");

  return (
    <>
      <div ref={triggerRef} title={triggerTitle}>
        <LiquidGlassHoverItem
          className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[100px]"
          onClick={toggle}
          onMouseEnter={(event) => triggerIconAnimation(event.currentTarget)}
        >
          <HoverAnimatedIcon
            icon={Gauge}
            iconName="gauge"
            size={16}
            strokeWidth={2}
            className={buttonActiveClassName}
          />
        </LiquidGlassHoverItem>
      </div>

      {isOpen &&
        isPositioned &&
        createPortal(
          <div
            ref={panelRef}
            className={`${DROPDOWN_CLASSES.panelAnimated} fixed max-h-[600px] w-[340px] overflow-hidden rounded-xl`}
            style={{
              top: panelPosition.top,
              bottom: panelPosition.bottom,
              left: panelPosition.left,
            }}
          >
            <div className="max-h-[600px] space-y-2 overflow-y-auto px-3 pt-3 scrollbar-hide">
              <MemoryStatRow
                label={t("layoutSettings.ramFps")}
                value={fpsValue}
                emphasized
                tone={
                  isSamplingFps
                    ? "muted"
                    : fpsSample.fps !== null &&
                        fpsSample.fps > SUCCESS_FPS_THRESHOLD
                      ? "success"
                      : undefined
                }
              />
              <MemoryStatRow
                label={tSettings("monitor.memory")}
                value={formatMegabytes(totalMemoryMb)}
                emphasized
                tone={
                  totalMemoryMb > 0 && totalMemoryMb < SUCCESS_RAM_THRESHOLD_MB
                    ? "success"
                    : undefined
                }
              />
              <MemoryStatRow
                label={tSettings("monitor.webViewDomNodes")}
                value={String(webViewDiagnostics?.domNodes ?? 0)}
              />
              <MemoryStatRow
                label={tSettings("monitor.webViewCompositedCandidates", {
                  sampled: webViewDiagnostics?.compositedSampleCount ?? 0,
                })}
                value={String(
                  webViewDiagnostics?.compositedCandidateCount ?? 0
                )}
              />

              <div className="my-2 border-t border-border-2" />
              <MemoryStatRow
                label={tSettings("monitor.memoryBreakdown")}
                value={null}
                emphasized
              />
              {visibleRamBreakdownRows.map((row) => {
                const isAttributionHeader = row.key === "attributionHintsGroup";
                const isAttributionDetail =
                  !isAttributionHeader &&
                  row.key !== "backendGroup" &&
                  row.key !== "backendFileCache" &&
                  row.key !== "frontendGroup" &&
                  row.key !== "tauriWebViewRenderer" &&
                  row.key !== "tauriGpuProcess" &&
                  row.key !== "tauriNetworkProcess" &&
                  row.key !== "otherProcessesGroup" &&
                  !row.key.startsWith("child-");
                if (isAttributionHeader) return null;
                if (isAttributionDetail && !showAttributionHints) return null;

                return (
                  <React.Fragment key={row.key}>
                    {row.key === "webViewEstimatesGroup" && (
                      <div className="my-2 border-t border-border-2" />
                    )}
                    <MemoryStatRow
                      label={
                        row.detail &&
                        ["chatRenderedTree", "sessionStore"].includes(row.key)
                          ? `${row.label} · ${row.detail}`
                          : row.label
                      }
                      value={row.value}
                      emphasized={row.emphasized}
                      indentLevel={row.indentLevel}
                    />
                  </React.Fragment>
                );
              })}
              <Button
                variant="tertiary"
                appearance="ghost"
                size="mini"
                iconOnly
                long
                className="justify-center"
                aria-label={
                  showAttributionHints
                    ? tCommon("showLess")
                    : tCommon("showMore")
                }
                icon={
                  showAttributionHints ? (
                    <ChevronUp size={13} strokeWidth={2} />
                  ) : (
                    <ChevronDown size={13} strokeWidth={2} />
                  )
                }
                onClick={handleToggleAttributionHints}
              />

              {snapshot.errorMessage && (
                <div className="text-danger-7 rounded-md border border-danger-3 bg-danger-1 px-2 py-1.5 text-[11px] leading-snug">
                  {tCommon("status.error")} · {snapshot.errorMessage}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
});

SidebarRamMonitorButton.displayName = "SidebarRamMonitorButton";
