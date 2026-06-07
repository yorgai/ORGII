import type React from "react";

import type { WebViewRuntimeDiagnostics } from "@src/hooks/perf";

import type { CHILD_PROCESS_CATEGORY } from "./constants";

export type ChildProcessCategory =
  (typeof CHILD_PROCESS_CATEGORY)[keyof typeof CHILD_PROCESS_CATEGORY];

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

export interface ChildProcessInfo {
  pid: number;
  parent_pid?: number | null;
  name: string;
  memory_mb: number;
  virtual_memory_mb?: number;
  category: ChildProcessCategory | string;
  depth?: number;
}

export interface PtyMemoryInfo {
  session_id: string;
  pid?: number | null;
  shell: string;
  memory_mb: number;
  buffer_bytes: number;
  scrollback_lines: number;
}

export interface MemoryBreakdown {
  backend_rss_mb: number;
  tracked_backend_mb: number;
  file_cache_mb: number;
}

export interface MetricsSnapshot {
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

export interface MemoryStatRowProps {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasized?: boolean;
  tone?: "success" | "muted";
  indentLevel?: number;
}

export interface MemoryBreakdownRow {
  key: string;
  label: React.ReactNode;
  value: string;
  bytes: number;
  detail?: string;
  emphasized?: boolean;
  indentLevel?: number;
}

export interface SidebarRamMonitorPanelProps {
  isOpen: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelPosition: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
}
