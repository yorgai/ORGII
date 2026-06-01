/**
 * Populates the model alias registry from key records so model icons and labels
 * can resolve user-chosen aliases globally.
 *
 * Mount once at app level.
 */
import { useEffect } from "react";

import { listKeys } from "@src/api/services/keyValidation";

import { replaceModelAliasesFromKeys } from "./modelAliasRegistry";

export function useModelAliasRegistry(): void {
  useEffect(() => {
    let cancelled = false;

    async function populate() {
      const keys = await listKeys();
      if (cancelled) return;

      replaceModelAliasesFromKeys(keys);
    }

    void populate();
    return () => {
      cancelled = true;
    };
  }, []);
}
