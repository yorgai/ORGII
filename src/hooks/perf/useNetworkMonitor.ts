/**
 * Network Monitor Hook
 *
 * Tracks online/offline status, in-flight HTTP requests, and rolling
 * request statistics (total, failed, avg latency) over a 5-minute window.
 *
 * Also fetches public IP + geolocation on demand (for VPN/region hints)
 * and captures LLM provider edge regions from response headers.
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ────────────────────────────────────────────────

export type ConnectionStatus = "online" | "offline";

export interface RequestRecord {
  url: string;
  method: string;
  domain: string;
  status: number;
  latencyMs: number;
  timestamp: number;
  ok: boolean;
}

export interface RequestStats {
  /** Total requests in the rolling window */
  total: number;
  /** Failed requests (status >= 400 or network error) */
  failed: number;
  /** Average latency in ms */
  avgLatencyMs: number;
  /** Requests grouped by domain */
  byDomain: Record<string, { total: number; failed: number; avgMs: number }>;
}

export interface GeoInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
  loading: boolean;
  error: string | null;
}

/** Edge region detected from a provider's response headers */
export interface ProviderRegion {
  provider: string;
  region: string;
  lastSeen: number;
}

export interface UseNetworkMonitorResult {
  /** Current connection status */
  connection: ConnectionStatus;
  /** Number of in-flight requests right now */
  inflightCount: number;
  /** Rolling request statistics (5 min window) */
  stats: RequestStats;
  /** Public IP + geolocation (fetched on demand) */
  geo: GeoInfo;
  /** Detected LLM provider edge regions */
  providerRegions: ProviderRegion[];
  /** Fetch geo info (call once when section expands) */
  fetchGeo: () => Promise<void>;
  /** Force re-fetch geo info (for manual refresh) */
  refreshGeo: () => Promise<void>;
  /** Reset all collected stats, records, and provider regions */
  resetStats: () => void;
}

// ── Constants ────────────────────────────────────────────

/** Rolling window for request stats */
const STATS_WINDOW_MS = 5 * 60 * 1000;

/** Max records kept in memory (FIFO) */
const MAX_RECORDS = 500;

/** Known provider header → provider name mapping */
const _PROVIDER_HEADER_MAP: Record<string, string> = {
  "x-request-id": "OpenAI",
  "anthropic-ratelimit-requests-limit": "Anthropic",
  "x-ds-trace-id": "DeepSeek",
};

/** Headers that reveal edge/region info */
const REGION_HEADERS = ["cf-ray", "x-served-by", "x-edge-location", "server"];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function detectProviderFromDomain(domain: string): string | null {
  if (domain.includes("openai")) return "OpenAI";
  if (domain.includes("anthropic")) return "Anthropic";
  if (domain.includes("deepseek")) return "DeepSeek";
  if (domain.includes("googleapis") || domain.includes("generativelanguage"))
    return "Google";
  if (domain.includes("groq")) return "Groq";
  if (domain.includes("together")) return "Together";
  return null;
}

function extractRegionFromHeaders(headers: Headers): string | null {
  for (const header of REGION_HEADERS) {
    const value = headers.get(header);
    if (value) {
      // cf-ray format: "8a1b2c3d4e5f6g7h-DFW" → extract "DFW"
      if (header === "cf-ray") {
        const dash = value.lastIndexOf("-");
        if (dash > 0) return value.slice(dash + 1);
      }
      return value;
    }
  }
  return null;
}

// ── Shared interceptor state (module-level, singleton) ───

let interceptorInstalled = false;
let originalFetch: typeof globalThis.fetch | null = null;

type RecordListener = (record: RequestRecord) => void;
type InflightListener = (delta: number) => void;
type ProviderListener = (region: ProviderRegion) => void;

const recordListeners = new Set<RecordListener>();
const inflightListeners = new Set<InflightListener>();
const providerListeners = new Set<ProviderListener>();

function installFetchInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  originalFetch = globalThis.fetch;

  globalThis.fetch = async function interceptedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const domain = extractDomain(url);
    const start = performance.now();

    // Notify inflight +1
    inflightListeners.forEach((listener) => listener(1));

    try {
      const response = await originalFetch!(input, init);
      const latencyMs = performance.now() - start;

      const record: RequestRecord = {
        url,
        method: method.toUpperCase(),
        domain,
        status: response.status,
        latencyMs,
        timestamp: Date.now(),
        ok: response.ok,
      };
      recordListeners.forEach((listener) => listener(record));

      // Check for provider region headers
      const provider = detectProviderFromDomain(domain);
      if (provider) {
        const region = extractRegionFromHeaders(response.headers);
        if (region) {
          const providerRegion: ProviderRegion = {
            provider,
            region,
            lastSeen: Date.now(),
          };
          providerListeners.forEach((listener) => listener(providerRegion));
        }
      }

      return response;
    } catch (err) {
      const latencyMs = performance.now() - start;
      const record: RequestRecord = {
        url,
        method: method.toUpperCase(),
        domain,
        status: 0,
        latencyMs,
        timestamp: Date.now(),
        ok: false,
      };
      recordListeners.forEach((listener) => listener(record));
      throw err;
    } finally {
      // Notify inflight -1
      inflightListeners.forEach((listener) => listener(-1));
    }
  };
}

// ── Hook ─────────────────────────────────────────────────

export function useNetworkMonitor(): UseNetworkMonitorResult {
  const [connection, setConnection] = useState<ConnectionStatus>(
    navigator.onLine ? "online" : "offline"
  );
  const [inflightCount, setInflightCount] = useState(0);
  const [stats, setStats] = useState<RequestStats>({
    total: 0,
    failed: 0,
    avgLatencyMs: 0,
    byDomain: {},
  });
  const [geo, setGeo] = useState<GeoInfo>({
    ip: "",
    city: "",
    region: "",
    country: "",
    org: "",
    loading: false,
    error: null,
  });
  const [providerRegions, setProviderRegions] = useState<ProviderRegion[]>([]);

  const recordsRef = useRef<RequestRecord[]>([]);
  const providerRegionsRef = useRef<Map<string, ProviderRegion>>(new Map());

  // ── Online / Offline ──
  useEffect(() => {
    const goOnline = () => setConnection("online");
    const goOffline = () => setConnection("offline");
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Fetch interceptor ──
  useEffect(() => {
    installFetchInterceptor();

    const onRecord: RecordListener = (record) => {
      const records = recordsRef.current;
      records.push(record);

      // FIFO eviction
      if (records.length > MAX_RECORDS) {
        records.splice(0, records.length - MAX_RECORDS);
      }

      // Recompute stats from rolling window
      const cutoff = Date.now() - STATS_WINDOW_MS;
      const windowRecords = records.filter((rec) => rec.timestamp >= cutoff);

      const byDomain: RequestStats["byDomain"] = {};
      let totalLatency = 0;
      let failedCount = 0;

      for (const rec of windowRecords) {
        totalLatency += rec.latencyMs;
        if (!rec.ok) failedCount++;

        if (!byDomain[rec.domain]) {
          byDomain[rec.domain] = { total: 0, failed: 0, avgMs: 0 };
        }
        byDomain[rec.domain].total++;
        if (!rec.ok) byDomain[rec.domain].failed++;
        byDomain[rec.domain].avgMs +=
          (rec.latencyMs - byDomain[rec.domain].avgMs) /
          byDomain[rec.domain].total;
      }

      setStats({
        total: windowRecords.length,
        failed: failedCount,
        avgLatencyMs:
          windowRecords.length > 0 ? totalLatency / windowRecords.length : 0,
        byDomain,
      });
    };

    const onInflight: InflightListener = (delta) => {
      setInflightCount((prev) => Math.max(0, prev + delta));
    };

    const onProvider: ProviderListener = (region) => {
      providerRegionsRef.current.set(region.provider, region);
      setProviderRegions(Array.from(providerRegionsRef.current.values()));
    };

    recordListeners.add(onRecord);
    inflightListeners.add(onInflight);
    providerListeners.add(onProvider);

    return () => {
      recordListeners.delete(onRecord);
      inflightListeners.delete(onInflight);
      providerListeners.delete(onProvider);
    };
  }, []);

  // ── Geo lookup (via Rust to bypass webview HTTP cache) ──
  const doFetchGeo = useCallback(async () => {
    setGeo((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await invoke<{
        ip: string;
        city: string;
        region: string;
        country: string;
        org: string;
      }>("fetch_geo_info");
      setGeo({
        ip: data.ip,
        city: data.city,
        region: data.region,
        country: data.country,
        org: data.org,
        loading: false,
        error: null,
      });
    } catch (err) {
      setGeo((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const fetchGeo = useCallback(async () => {
    if (geo.ip && !geo.error) return; // Already fetched — skip auto-fetch
    await doFetchGeo();
  }, [geo.ip, geo.error, doFetchGeo]);

  // ── Reset stats ──
  const resetStats = useCallback(() => {
    recordsRef.current = [];
    providerRegionsRef.current.clear();
    setInflightCount(0);
    setStats({ total: 0, failed: 0, avgLatencyMs: 0, byDomain: {} });
    setProviderRegions([]);
  }, []);

  return {
    connection,
    inflightCount,
    stats,
    geo,
    providerRegions,
    fetchGeo,
    refreshGeo: doFetchGeo,
    resetStats,
  };
}
