/**
 * Monitor Settings Section
 *
 * Displays real-time RAM, CPU, and network usage using Rust performance monitoring
 */
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ProgressBar } from "@src/components/ProgressBar";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";

import NetworkSection from "./NetworkSection";
import RamHistoryChart from "./RamHistoryChart";
import StorageSection from "./StorageSection";
import {
  type BreakdownRow,
  type ChildProcessInfo,
  formatMemory,
  useMonitorMetrics,
} from "./useMonitorMetrics";

export const MONITOR_TAB_KEYS = {
  RESOURCES: "resources",
  NETWORK: "network",
  STORAGE: "storage",
} as const;

export type MonitorTabKey =
  (typeof MONITOR_TAB_KEYS)[keyof typeof MONITOR_TAB_KEYS];

interface MonitorSectionProps {
  activeTab?: string;
}

const MonitorSection: React.FC<MonitorSectionProps> = ({
  activeTab = MONITOR_TAB_KEYS.RESOURCES,
}) => {
  const { t } = useTranslation("settings");

  const {
    processMetrics,
    systemMemory,
    memoryBreakdown,
    childProcesses,
    systemInfo,
    ramHistory,
    containerRef,
  } = useMonitorMetrics(activeTab);

  const backendMemoryMb = processMetrics?.memory_rss_mb ?? 0;
  const webviewMemoryMb = childProcesses
    .filter((proc) => ["webview", "gpu", "network"].includes(proc.category))
    .reduce((sum, child) => sum + child.memory_mb, 0);
  const toolProcessMemoryMb = childProcesses
    .filter((proc) => !["webview", "gpu", "network"].includes(proc.category))
    .reduce((sum, child) => sum + child.memory_mb, 0);
  const totalMemoryMb = backendMemoryMb + webviewMemoryMb + toolProcessMemoryMb;
  const systemTotalMb = systemMemory?.total_mb ?? 1;
  const totalMemoryPercent = (totalMemoryMb / systemTotalMb) * 100;

  const terminalCount = childProcesses.filter(
    (proc) => proc.category === "terminal"
  ).length;
  const webviewCount = childProcesses.filter(
    (proc) => proc.category === "webview"
  ).length;

  function buildChildProcessDescription(): string {
    const helperMemoryMb = webviewMemoryMb + toolProcessMemoryMb;
    if (childProcesses.length === 0) {
      return "No WebKit or tool helper processes";
    }
    const parts: string[] = [formatMemory(helperMemoryMb)];
    if (terminalCount > 0 && terminalCount === childProcesses.length) {
      parts.unshift(
        terminalCount +
          " " +
          (terminalCount > 1
            ? t("monitor.terminalProcesses")
            : t("monitor.terminalProcess"))
      );
    } else if (webviewCount > 0 && webviewCount === childProcesses.length) {
      parts.unshift(
        webviewCount +
          " " +
          (webviewCount > 1
            ? t("monitor.webviewProcesses")
            : t("monitor.webviewProcess"))
      );
    } else {
      parts.unshift(childProcesses.length + " " + t("monitor.processes"));
    }
    return parts.join(" \u00b7 ");
  }

  const categoryLabels: Record<string, string> = useMemo(
    () => ({
      terminal: t("monitor.categoryTerminal"),
      webview: t("monitor.categoryWebview"),
      gpu: t("monitor.categoryGpu"),
      network: t("monitor.categoryNetwork"),
      other: t("monitor.categoryOther"),
    }),
    [t]
  );

  const breakdownRows = useMemo<BreakdownRow[]>(() => {
    if (!memoryBreakdown) return [];
    return [
      {
        key: "backendRss",
        label: t("monitor.breakdownBackendRss"),
        megabytes: memoryBreakdown.backend_rss_mb,
        totalMb: totalMemoryMb,
      },
      {
        key: "webkitHelpers",
        label: t("monitor.breakdownWebkitHelpers"),
        megabytes: webviewMemoryMb,
        totalMb: totalMemoryMb,
      },
      {
        key: "toolHelpers",
        label: t("monitor.breakdownToolHelpers"),
        megabytes: toolProcessMemoryMb,
        totalMb: totalMemoryMb,
      },
      {
        key: "backendFileCache",
        label: t("monitor.breakdownFileCache"),
        megabytes: memoryBreakdown.file_cache_mb,
        totalMb: backendMemoryMb,
      },
    ].sort((rowA, rowB) => rowB.megabytes - rowA.megabytes);
  }, [
    memoryBreakdown,
    backendMemoryMb,
    totalMemoryMb,
    webviewMemoryMb,
    toolProcessMemoryMb,
    t,
  ]);

  const breakdownColumns = useMemo<SettingsTableColumn<BreakdownRow>[]>(
    () => [
      {
        key: "subsystem",
        label: t("monitor.tableSubsystem"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.primary}>{row.label}</span>
        ),
      },
      {
        key: "size",
        label: t("monitor.tableSize"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => rowA.megabytes - rowB.megabytes,
        renderCell: (row) => (
          <span className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap`}>
            {formatMemory(row.megabytes)}
          </span>
        ),
      },
      {
        key: "percent",
        label: t("monitor.tablePercent"),
        width: SETTINGS_TABLE_COL.valueMd,
        align: "right" as const,
        renderCell: (row) => {
          const pct =
            row.totalMb > 0
              ? ((row.megabytes / row.totalMb) * 100).toFixed(1)
              : "0";
          return (
            <span className={`${SETTINGS_TABLE_CELL.muted} whitespace-nowrap`}>
              {pct}%
            </span>
          );
        },
      },
    ],
    [t]
  );

  const childColumns = useMemo<SettingsTableColumn<ChildProcessInfo>[]>(
    () => [
      {
        key: "name",
        label: t("monitor.tableName"),
        width: SETTINGS_TABLE_COL.valueSm,
        sorter: (rowA, rowB) => rowA.name.localeCompare(rowB.name),
        renderCell: (child) => (
          <span className={`${SETTINGS_TABLE_CELL.primary} whitespace-nowrap`}>
            {child.name}
          </span>
        ),
      },
      {
        key: "detail",
        label: t("monitor.tableDetail"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (child) => (
          <span className={SETTINGS_TABLE_CELL.muted}>
            {categoryLabels[child.category] || child.category} · PID {child.pid}
          </span>
        ),
      },
      {
        key: "memory",
        label: t("monitor.tableMemory"),
        width: SETTINGS_TABLE_COL.valueMd,
        sorter: (rowA, rowB) => rowA.memory_mb - rowB.memory_mb,
        renderCell: (child) => (
          <span className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap`}>
            {formatMemory(child.memory_mb)}
          </span>
        ),
      },
      {
        key: "percent",
        label: t("monitor.tablePercent"),
        width: SETTINGS_TABLE_COL.valueMd,
        align: "right" as const,
        renderCell: (child) => {
          const totalMb = childProcesses.reduce(
            (sum, cp) => sum + cp.memory_mb,
            0
          );
          const pct =
            totalMb > 0 ? ((child.memory_mb / totalMb) * 100).toFixed(1) : "0";
          return (
            <span className={`${SETTINGS_TABLE_CELL.value} whitespace-nowrap`}>
              {pct}%
            </span>
          );
        },
      },
    ],
    [t, categoryLabels, childProcesses]
  );

  function getProgressColor(percent: number): string {
    if (percent > 50) return "bg-red-500";
    if (percent > 25) return "bg-yellow-500";
    return "bg-green-500";
  }

  const cpuPercent = processMetrics?.cpu_percent || 0;
  const systemDesc = systemInfo
    ? systemInfo.os_name +
      " " +
      systemInfo.os_version +
      " · " +
      systemInfo.chip_type
    : "";
  const memoryLabel =
    formatMemory(totalMemoryMb) +
    " / " +
    formatMemory(systemTotalMb) +
    " (backend " +
    formatMemory(backendMemoryMb) +
    ", WebKit " +
    formatMemory(webviewMemoryMb) +
    ", tools " +
    formatMemory(toolProcessMemoryMb) +
    ")";

  return (
    <div ref={containerRef} className={SECTION_GAP_CLASSES}>
      {activeTab === MONITOR_TAB_KEYS.RESOURCES && (
        <>
          <SectionContainer>
            <SectionRow
              label={t("monitor.performanceMonitor")}
              description={systemDesc}
            />
            <SectionRow label="" indent showHeader={false}>
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-2">
                      {t("monitor.cpu")} {cpuPercent.toFixed(1)}%
                    </span>
                    <span className="text-xs text-text-2">
                      {t("monitor.perCoreUsage")}
                    </span>
                  </div>
                  <ProgressBar percent={cpuPercent} color="bg-primary-6" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-2">
                      {t("monitor.memory")} {totalMemoryPercent.toFixed(1)}%
                    </span>
                    <span className="text-xs text-text-2">{memoryLabel}</span>
                  </div>
                  <ProgressBar
                    percent={totalMemoryPercent}
                    color={getProgressColor(totalMemoryPercent)}
                  />
                </div>
              </div>
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label={t("monitor.ramHistory")}
              description={t("monitor.ramHistoryDesc")}
            />
            <SectionRow label="" indent showHeader={false}>
              <RamHistoryChart stats={ramHistory} />
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label={t("monitor.memoryBreakdown")}
              description={t("monitor.allocationBySubsystem")}
            />
            <SectionRow label="" indent showHeader={false}>
              {breakdownRows.length > 0 ? (
                <SettingsTable<BreakdownRow>
                  columns={breakdownColumns}
                  rows={breakdownRows}
                  getRowKey={(row) => row.key}
                  showHeader={false}
                  noPx
                />
              ) : (
                <div className="py-2 text-xs text-text-3">
                  {t("monitor.breakdownNotImplemented")}
                </div>
              )}
            </SectionRow>
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label="WebKit & tool helper processes"
              description={buildChildProcessDescription()}
            />
            {childProcesses.length > 0 && (
              <SectionRow label="" indent showHeader={false}>
                <SettingsTable<ChildProcessInfo>
                  columns={childColumns}
                  rows={childProcesses}
                  getRowKey={(child) => String(child.pid)}
                  showHeader={false}
                  noPx
                />
              </SectionRow>
            )}
          </SectionContainer>
        </>
      )}

      {activeTab === MONITOR_TAB_KEYS.NETWORK && <NetworkSection />}
      {activeTab === MONITOR_TAB_KEYS.STORAGE && <StorageSection />}
    </div>
  );
};

export default MonitorSection;
