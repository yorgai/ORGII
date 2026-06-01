/**
 * useOrgiiPoolCategories
 *
 * Single source of ORGII pool category data for the UI layer. Returns:
 *   - `orgiiCategories`: raw list from the backend config
 *   - `orgiiModelSet`:   `Map<modelId, category>` for O(1) lookup
 *   - `orgiiCategoryIds`: `Set<tierId>` for tier-id membership checks
 *
 * In the OSS build the underlying config is a static stub (empty pool) — see
 * `@src/api/http/orgiiHosted/poolConfig`. Consumers:
 *   - `UnifiedModelPalette` — Recent-tab filter + source options
 *   - `useValidatedLastPair` — compatibility gate for the stored pair
 */
import { useEffect, useMemo, useState } from "react";

import {
  getORGIIPoolConfig,
  getORGIIPoolConfigCached,
} from "@src/api/http/orgiiHosted/poolConfig";
import type { ORGIIPoolCategory } from "@src/types/model/pool";

export interface UseOrgiiPoolCategoriesResult {
  orgiiCategories: ORGIIPoolCategory[];
  orgiiModelSet: ReadonlyMap<string, ORGIIPoolCategory>;
  orgiiCategoryIds: ReadonlySet<string>;
}

export function useOrgiiPoolCategories(
  enabled: boolean = true
): UseOrgiiPoolCategoriesResult {
  const [orgiiCategories, setOrgiiCategories] = useState<ORGIIPoolCategory[]>(
    () => (enabled ? (getORGIIPoolConfigCached()?.categories ?? []) : [])
  );

  useEffect(() => {
    if (!enabled) return;
    if (getORGIIPoolConfigCached()) return;
    let cancelled = false;
    getORGIIPoolConfig()
      .then((config) => {
        if (!cancelled) setOrgiiCategories(config.categories);
      })
      .catch(() => {
        if (!cancelled) setOrgiiCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const orgiiModelSet = useMemo(() => {
    const map = new Map<string, ORGIIPoolCategory>();
    for (const category of orgiiCategories) {
      for (const model of category.models) {
        map.set(model, category);
      }
    }
    return map;
  }, [orgiiCategories]);

  const orgiiCategoryIds = useMemo(
    () => new Set(orgiiCategories.map((cat) => cat.id)),
    [orgiiCategories]
  );

  return { orgiiCategories, orgiiModelSet, orgiiCategoryIds };
}
