import { useCallback, useEffect, useState } from "react";

import {
  type ContainerEngineStatus,
  type ContainerSummary,
  containerApi,
} from "@src/api/tauri/container";

import { useContainerEngine } from "./useContainerEngine";

interface ContainersSnapshot {
  key: number;
  containers: ContainerSummary[];
  error: string | null;
}

export function useContainers(enabled = true) {
  const engine = useContainerEngine(enabled);
  const refreshEngine = engine.refresh;
  const [snapshot, setSnapshot] = useState<ContainersSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    refreshEngine();
    setTick((prev) => prev + 1);
  }, [refreshEngine]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const key = tick;

    containerApi
      .listContainers()
      .then((containers) => {
        if (!cancelled) setSnapshot({ key, containers, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSnapshot({
          key,
          containers: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const loading = enabled ? snapshot?.key !== tick || engine.loading : false;
  const currentSnapshot = snapshot?.key === tick ? snapshot : null;
  const engineStatus: ContainerEngineStatus | null = engine.status;

  return {
    engineStatus,
    containers: currentSnapshot?.containers ?? [],
    error: currentSnapshot?.error ?? engineStatus?.error ?? null,
    loading,
    refresh,
  };
}
