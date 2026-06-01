/**
 * Performance Hooks
 *
 * Provides React hooks for:
 * - Debouncing callbacks (useDebouncedCallback)
 * - Network monitoring (useNetworkMonitor)
 */

export { useDebouncedCallback, DEBOUNCE_DELAYS } from "./useDebouncedCallback";
export { useNetworkMonitor } from "./useNetworkMonitor";
export { useRamHistory } from "./useRamHistory";
export {
  formatRuntimeBytes,
  useRuntimeRamStats,
  type RuntimeRamPartRow,
  type UseRuntimeRamStatsResult,
} from "./useRuntimeRamStats";
export {
  SIDEBAR_MEMORY_KIND,
  collectWebViewRuntimeDiagnostics,
  type SidebarMemoryKind,
  type WebViewRuntimeDiagnostics,
} from "./runtimeMemoryStats";
export { useSidebarMemoryEntry } from "./useSidebarMemoryEntry";
export type {
  RamHistoryStats,
  RamSample,
  UseRamHistoryResult,
} from "./useRamHistory";
export type {
  ConnectionStatus,
  GeoInfo,
  ProviderRegion,
  RequestStats,
  UseNetworkMonitorResult,
} from "./useNetworkMonitor";
