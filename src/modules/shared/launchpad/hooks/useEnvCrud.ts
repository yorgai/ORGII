/**
 * useEnvCrud
 *
 * Wraps useEnvScan with add/edit/delete operations for env vars.
 * All mutations write back to .env and trigger a re-scan.
 */
import { useCallback } from "react";

import type { EnvVar } from "../types";
import { useEnvScan } from "./useEnvScan";

export function useEnvCrud(repoPath: string | undefined) {
  const scan = useEnvScan(repoPath);

  const addVar = useCallback(
    async (key: string, value: string, comment?: string) => {
      const existing = scan.vars.find((v) => v.key === key);
      if (existing) return;

      const updated: EnvVar[] = [
        ...scan.vars,
        { key, value, source: "env", filled: value !== "", comment },
      ];
      await scan.saveEnvValues(updated);
    },
    [scan]
  );

  const updateVar = useCallback(
    async (key: string, newValue: string) => {
      const updated = scan.vars.map((v) =>
        v.key === key
          ? {
              ...v,
              value: newValue,
              filled: newValue !== "",
              source: "env" as const,
            }
          : v
      );
      await scan.saveEnvValues(updated);
    },
    [scan]
  );

  const deleteVar = useCallback(
    async (key: string) => {
      const updated = scan.vars.filter((v) => v.key !== key);
      await scan.saveEnvValues(updated);
    },
    [scan]
  );

  return {
    ...scan,
    addVar,
    updateVar,
    deleteVar,
  };
}
