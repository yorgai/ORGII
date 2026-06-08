import { useCallback, useEffect, useState } from "react";

import {
  CONTAINER_ENGINE_KIND,
  type ContainerEngineCandidate,
  containerApi,
} from "@src/api/tauri/container";

interface EngineCandidatesSnapshot {
  key: number;
  engines: ContainerEngineCandidate[];
  error: string | null;
}

export function filterRemoteContainerEngines(
  engines: ContainerEngineCandidate[]
): ContainerEngineCandidate[] {
  return engines.filter(
    (engine) => engine.kind !== CONTAINER_ENGINE_KIND.LOCAL
  );
}

export function useContainerEngines(enabled = true) {
  const [snapshot, setSnapshot] = useState<EngineCandidatesSnapshot | null>(
    null
  );
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const key = tick;

    containerApi
      .listEngineCandidates()
      .then((engines) => {
        if (!cancelled) setSnapshot({ key, engines, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSnapshot({
          key,
          engines: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const currentSnapshot = snapshot?.key === tick ? snapshot : null;
  const engines = currentSnapshot?.engines ?? [];

  return {
    engines,
    remoteEngines: filterRemoteContainerEngines(engines),
    error: currentSnapshot?.error ?? null,
    loading: enabled ? snapshot?.key !== tick : false,
    refresh,
  };
}
