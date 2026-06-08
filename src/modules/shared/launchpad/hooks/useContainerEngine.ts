import { useCallback, useEffect, useState } from "react";

import {
  type ContainerEngineStatus,
  containerApi,
} from "@src/api/tauri/container";

interface EngineSnapshot {
  key: number;
  status: ContainerEngineStatus | null;
}

export function useContainerEngine(enabled = true) {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setTick((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const key = tick;

    containerApi
      .pingEngine()
      .then((status) => {
        if (!cancelled) setSnapshot({ key, status });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSnapshot({
          key,
          status: {
            available: false,
            engine_id: "local",
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const loading = enabled ? snapshot?.key !== tick : false;

  return {
    status: snapshot?.key === tick ? snapshot.status : null,
    loading,
    refresh,
  };
}
