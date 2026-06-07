import type { MetricsSnapshot } from "./types";

export const METRICS_POLL_INTERVAL_MS = 5000;
export const SUCCESS_FPS_THRESHOLD = 40;
export const SUCCESS_RAM_THRESHOLD_MB = 1024;

export const CHILD_PROCESS_CATEGORY = {
  TERMINAL: "terminal",
  WEBVIEW: "webview",
  GPU: "gpu",
  NETWORK: "network",
  OTHER: "other",
} as const;

export const EMPTY_SNAPSHOT: MetricsSnapshot = {
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
