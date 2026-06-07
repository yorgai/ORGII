import type { MetricsSnapshot } from "./types";

export function formatMegabytes(megabytes: number): string {
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(1)} MB`;
}

export function getAppMemoryTotal(snapshot: MetricsSnapshot): number {
  return snapshot.processMetrics?.memory_rss_mb ?? 0;
}
