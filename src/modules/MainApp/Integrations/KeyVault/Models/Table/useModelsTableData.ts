import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getORGIIPoolConfig } from "@src/api/http/orgiiHosted/poolConfig";
import { formatModelAgentType } from "@src/assets/providers";
import { ORGII_ORCHESTRATOR } from "@src/assets/providers/types";
import type { SelectOption } from "@src/components/Select";
import type { SettingsTableSelectFilter } from "@src/components/SettingsTable";
import {
  ORGII_FALLBACK_TIERS,
  isOrgiiTierModel,
} from "@src/config/orgiiCategories";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { ORGIIPoolCategory } from "@src/types/model/pool";
import {
  getModelFamily,
  groupModels,
  isLegacyGroup,
} from "@src/util/modelGrouping";
import { normalizedIncludes } from "@src/util/search/fuzzy";

import type {
  ConsolidatedModelRow,
  ModelSourceEntry,
} from "../../../Tables/types";
import {
  ALL_FILTER,
  MIN_FAMILY_SIZE,
  MODEL_SCOPE,
  OTHER_FILTER,
  STATUS_FILTER,
  TOKEN_MARKET_SOURCE,
} from "./modelsTableUtils";

export function useModelsTableData(
  accounts: KeyVaultAccount[],
  t: (key: string, options?: { defaultValue?: string }) => string
) {
  const [modelsSearchQuery, setModelsSearchQuery] = useState("");
  const [hideOlder, setHideOlder] = useState(true);
  const [familyFilter, setFamilyFilter] = useState(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState<
    (typeof STATUS_FILTER)[keyof typeof STATUS_FILTER]
  >(STATUS_FILTER.ALL);
  const [optimisticToggles, setOptimisticToggles] = useState<
    Map<string, boolean>
  >(new Map());
  const pendingRef = useRef<Set<string>>(new Set());

  const [orgiiCategories, setOrgiiCategories] = useState<ORGIIPoolCategory[]>(
    []
  );
  useEffect(() => {
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
  }, []);

  const displayTiers = useMemo(
    () => (orgiiCategories.length > 0 ? orgiiCategories : ORGII_FALLBACK_TIERS),
    [orgiiCategories]
  );

  const allModelNames = useMemo(
    () => accounts.flatMap((acc) => acc.availableModels ?? []),
    [accounts]
  );

  const olderModelSet = useMemo(() => {
    const groups = groupModels(allModelNames);
    const set = new Set<string>();
    for (const group of groups) {
      if (isLegacyGroup(group)) {
        for (const model of group.models) set.add(model);
      }
    }
    return set;
  }, [allModelNames]);

  const { displayFamilies, otherFamilySet } = useMemo(() => {
    const counts = new Map<string, number>();
    const unique = new Set(allModelNames);
    for (const model of unique) {
      const family = getModelFamily(model);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    const main: string[] = [];
    const other = new Set<string>();
    for (const [family, count] of counts) {
      if (family === OTHER_FILTER) {
        other.add(family);
      } else if (count >= MIN_FAMILY_SIZE) {
        main.push(family);
      } else {
        other.add(family);
      }
    }
    main.sort(
      (famA, famB) => (counts.get(famB) ?? 0) - (counts.get(famA) ?? 0)
    );
    return { displayFamilies: main, otherFamilySet: other };
  }, [allModelNames]);

  const tabCount = displayFamilies.length + (otherFamilySet.size > 0 ? 1 : 0);
  const showFamilyFilter = tabCount > 1;

  const familyFilterOptions = useMemo<SelectOption[]>(() => {
    if (!showFamilyFilter) return [];
    return [
      {
        value: ALL_FILTER,
        label: t("modelsTable.filterAllProvider"),
      },
      ...displayFamilies.map((family) => ({
        value: family,
        label: family,
      })),
      ...(otherFamilySet.size > 0
        ? [
            {
              value: OTHER_FILTER,
              label: t("modelsTable.filterOther"),
            },
          ]
        : []),
    ];
  }, [showFamilyFilter, displayFamilies, otherFamilySet, t]);

  const statusFilterOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: STATUS_FILTER.ALL,
        label: t("modelsTable.statusAll"),
      },
      {
        value: STATUS_FILTER.ENABLED,
        label: t("modelsTable.statusEnabled"),
      },
      {
        value: STATUS_FILTER.DISABLED,
        label: t("modelsTable.statusDisabled"),
      },
    ],
    [t]
  );

  useEffect(() => {
    if (pendingRef.current.size === 0) return;
    setOptimisticToggles((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const key of pendingRef.current) next.delete(key);
      pendingRef.current.clear();
      return next.size === prev.size ? prev : next;
    });
  }, [accounts]);

  const applyOptimisticToggle = useCallback(
    (model: string, agentType: string, checked: boolean) => {
      const key = `${model}|${agentType}`;
      setOptimisticToggles((prev) => new Map(prev).set(key, checked));
      pendingRef.current.add(key);
    },
    []
  );

  const consolidatedRows = useMemo((): ConsolidatedModelRow[] => {
    const sourceMap = new Map<string, Map<string, ModelSourceEntry>>();

    for (const acc of accounts) {
      const source = formatModelAgentType(acc.modelType);
      const enabled = acc.enabled
        ? new Set(acc.enabledModels ?? [])
        : new Set<string>();
      for (const model of acc.availableModels ?? []) {
        let modelSources = sourceMap.get(model);
        if (!modelSources) {
          modelSources = new Map();
          sourceMap.set(model, modelSources);
        }
        const isEnabled = enabled.has(model);
        const existing = modelSources.get(acc.modelType);
        if (existing) {
          existing.keys += 1;
          if (isEnabled) {
            existing.enabledKeys += 1;
            existing.enabled = true;
          }
        } else {
          modelSources.set(acc.modelType, {
            source,
            modelType: acc.modelType,
            keys: 1,
            enabledKeys: isEnabled ? 1 : 0,
            enabled: isEnabled,
          });
        }
      }
    }

    const rows: ConsolidatedModelRow[] = [];
    for (const [model, sourcesMap] of sourceMap) {
      const sources = Array.from(sourcesMap.values());
      for (const src of sources) {
        const key = `${model}|${src.modelType}`;
        const optimistic = optimisticToggles.get(key);
        if (optimistic !== undefined) {
          src.enabled = optimistic;
          src.enabledKeys = optimistic ? src.keys : 0;
        }
      }
      const allEnabled = sources.every((src) => src.enabledKeys === src.keys);
      const someEnabled = sources.some((src) => src.enabledKeys > 0);
      rows.push({
        model,
        sources,
        totalKeys: sources.reduce((sum, src) => sum + src.keys, 0),
        allEnabled,
        someEnabled,
        isOlder: olderModelSet.has(model),
      });
    }

    const orgiiRows: ConsolidatedModelRow[] = displayTiers.map((category) => ({
      model: `orgii:${category.id}`,
      sources: [
        {
          source: TOKEN_MARKET_SOURCE,
          modelType: ORGII_ORCHESTRATOR,
          keys: 0,
          enabledKeys: 0,
          enabled: true,
        },
      ],
      totalKeys: 0,
      allEnabled: true,
      someEnabled: true,
      isOlder: false,
    }));

    return [
      ...orgiiRows,
      ...rows.sort(
        (rowA, rowB) =>
          Number(
            rowA.someEnabled === rowB.someEnabled
              ? 0
              : rowA.someEnabled
                ? -1
                : 1
          ) || rowA.model.localeCompare(rowB.model)
      ),
    ];
  }, [accounts, optimisticToggles, olderModelSet, displayTiers]);

  const familyFilteredRows = useMemo(() => {
    let rows = consolidatedRows;
    if (familyFilter === OTHER_FILTER) {
      rows = rows.filter((row) =>
        otherFamilySet.has(getModelFamily(row.model))
      );
    } else if (familyFilter !== ALL_FILTER) {
      rows = rows.filter((row) => getModelFamily(row.model) === familyFilter);
    }
    if (statusFilter === STATUS_FILTER.ENABLED) {
      rows = rows.filter((row) => row.someEnabled);
    } else if (statusFilter === STATUS_FILTER.DISABLED) {
      rows = rows.filter((row) => !row.someEnabled);
    }
    return rows;
  }, [consolidatedRows, familyFilter, otherFamilySet, statusFilter]);

  const olderCount = useMemo(
    () => familyFilteredRows.filter((row) => row.isOlder).length,
    [familyFilteredRows]
  );

  const modelScopeOptions = useMemo<SelectOption[]>(
    () => [
      {
        value: MODEL_SCOPE.INCLUDE_OLDER,
        label: t("modelsTable.scopeSelectIncludeOlder"),
      },
      {
        value: MODEL_SCOPE.CURRENT,
        label: t("modelsTable.scopeSelectCurrentModels"),
      },
    ],
    [t]
  );

  const selectFilters = useMemo<SettingsTableSelectFilter[]>(() => {
    const filters: SettingsTableSelectFilter[] = [];
    if (showFamilyFilter) {
      filters.push({
        key: "family",
        value: familyFilter,
        defaultValue: ALL_FILTER,
        options: familyFilterOptions,
        onChange: (val) => setFamilyFilter(val as string),
      });
    }
    filters.push({
      key: "status",
      value: statusFilter,
      defaultValue: STATUS_FILTER.ALL,
      options: statusFilterOptions,
      onChange: (val) =>
        setStatusFilter(
          val as (typeof STATUS_FILTER)[keyof typeof STATUS_FILTER]
        ),
    });
    if (olderCount > 0) {
      filters.push({
        key: "modelScope",
        value: hideOlder ? MODEL_SCOPE.CURRENT : MODEL_SCOPE.INCLUDE_OLDER,
        defaultValue: MODEL_SCOPE.CURRENT,
        options: modelScopeOptions,
        minWidth: 160,
        onChange: (val) => {
          setHideOlder(val !== MODEL_SCOPE.INCLUDE_OLDER);
        },
      });
    }
    return filters;
  }, [
    showFamilyFilter,
    familyFilter,
    familyFilterOptions,
    statusFilter,
    statusFilterOptions,
    olderCount,
    hideOlder,
    modelScopeOptions,
  ]);

  const filteredRows = useMemo(() => {
    let rows = familyFilteredRows;
    if (hideOlder && !modelsSearchQuery.trim()) {
      rows = rows.filter((row) => !row.isOlder);
    }
    if (modelsSearchQuery.trim()) {
      const query = modelsSearchQuery.toLowerCase();
      rows = rows.filter(
        (row) =>
          normalizedIncludes(row.model.toLowerCase(), query) ||
          row.sources.some((src) =>
            normalizedIncludes(src.source.toLowerCase(), query)
          )
      );
    }
    return rows;
  }, [familyFilteredRows, modelsSearchQuery, hideOlder]);

  return {
    modelsSearchQuery,
    setModelsSearchQuery,
    hideOlder,
    setHideOlder,
    olderCount,
    consolidatedRows,
    filteredRows,
    selectFilters,
    applyOptimisticToggle,
    isOrgiiTierModel,
  };
}
