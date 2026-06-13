/**
 * useRamHistory — RAM usage history backed by a Rust ring buffer.
 *
 * The backend (`perf_utils::ram_history`) starts sampling at app launch
 * and keeps the last 24 h in a 2880-slot ring buffer. This hook hydrates
 * from that buffer on mount, then merges live samples (recorded by
 * `useMonitorMetrics`'s 5 s poll) on top so the chart updates between
 * 30 s backend ticks.
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@src/hooks/logger";

const log = createLogger("useRamHistory");

const DISPLAY_WINDOW_MS = 30 * 60 * 1000;
const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 2880;
const HYDRATE_REFRESH_MS = 30 * 1000;

export interface RamSample {
  timestamp: number;
  totalMb: number;
}

export interface RamHistoryStats {
  minMb: number;
  maxMb: number;
  avgMb: number;
  currentMb: number;
  samples: RamSample[];
}

interface BackendSample {
  timestamp: number;
  total_mb: number;
}

const EMPTY_STATS: RamHistoryStats = {
  minMb: 0,
  maxMb: 0,
  avgMb: 0,
  currentMb: 0,
  samples: [],
};

function computeStats(samples: RamSample[]): RamHistoryStats {
  if (samples.length === 0) return EMPTY_STATS;

  let minMb = Infinity;
  let maxMb = -Infinity;
  let sumMb = 0;

  for (const sample of samples) {
    if (sample.totalMb < minMb) minMb = sample.totalMb;
    if (sample.totalMb > maxMb) maxMb = sample.totalMb;
    sumMb += sample.totalMb;
  }

  return {
    minMb,
    maxMb,
    avgMb: sumMb / samples.length,
    currentMb: samples[samples.length - 1].totalMb,
    samples,
  };
}

function evict(buf: RamSample[]): void {
  const cutoff = Date.now() - CACHE_WINDOW_MS;
  while (
    buf.length > 0 &&
    (buf[0].timestamp < cutoff || buf.length > MAX_SAMPLES)
  ) {
    buf.shift();
  }
}

function visibleSamples(samples: RamSample[]): RamSample[] {
  const cutoff = Date.now() - DISPLAY_WINDOW_MS;
  return samples.filter((sample) => sample.timestamp >= cutoff);
}

export interface UseRamHistoryResult {
  stats: RamHistoryStats;
  recordSample: (totalMb: number) => void;
}

export function useRamHistory(): UseRamHistoryResult {
  const samplesRef = useRef<RamSample[]>([]);
  const [stats, setStats] = useState<RamHistoryStats>(EMPTY_STATS);

  const hydrate = useCallback(async () => {
    try {
      const backend = await invoke<BackendSample[]>("get_ram_history");
      const merged = new Map<number, RamSample>();
      for (const sample of backend) {
        if (sample.total_mb > 0) {
          merged.set(sample.timestamp, {
            timestamp: sample.timestamp,
            totalMb: sample.total_mb,
          });
        }
      }
      // Preserve any live samples newer than the latest backend sample.
      const newestBackend =
        backend.length > 0 ? backend[backend.length - 1].timestamp : 0;
      for (const live of samplesRef.current) {
        if (live.timestamp > newestBackend) {
          merged.set(live.timestamp, live);
        }
      }

      const sorted = Array.from(merged.values()).sort(
        (a, b) => a.timestamp - b.timestamp
      );
      evict(sorted);
      samplesRef.current = sorted;
      setStats(computeStats(visibleSamples(sorted)));
    } catch (err) {
      log.error("[useRamHistory] hydrate failed:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      if (!cancelled) void hydrate();
    }, 0);
    const intervalId = setInterval(() => {
      if (!cancelled) void hydrate();
    }, HYDRATE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [hydrate]);

  const recordSample = useCallback((totalMb: number) => {
    if (totalMb <= 0) return;

    const buf = samplesRef.current;
    buf.push({ timestamp: Date.now(), totalMb });
    evict(buf);

    setStats(computeStats(visibleSamples(buf)));
  }, []);

  return { stats, recordSample };
}
