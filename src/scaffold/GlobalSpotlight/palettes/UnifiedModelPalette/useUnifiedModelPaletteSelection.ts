import { useCallback, useEffect, useMemo, useState } from "react";

import { KEY_SOURCE } from "@src/api/tauri/session";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { accountHasModel } from "@src/hooks/models/useModelAccountLookup";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import { resolveDefaultVariant } from "@src/util/defaultModelVariant";
import {
  parseModelVariant,
  resolveModelVariantFields,
} from "@src/util/modelVariants";

import { buildSourceOptions } from "./sourceItems";
import type { SourceOption } from "./types";

type ActiveColumn = "models" | "sources";

interface UseUnifiedModelPaletteSelectionParams {
  isOpen: boolean;
  isCliAgent: boolean;
  accountLookupSize: number;
  accounts: KeyVaultAccount[];
  advancedConfig: AdvancedConfig;
  onConfigChange: (config: AdvancedConfig) => void;
  onClose: () => void;
  recordRecent: (entry: RecentModelEntry) => void;
}

export function useUnifiedModelPaletteSelection({
  isOpen,
  isCliAgent,
  accountLookupSize,
  accounts,
  advancedConfig,
  onConfigChange,
  onClose,
  recordRecent,
}: UseUnifiedModelPaletteSelectionParams) {
  const [activeColumn, setActiveColumn] = useState<ActiveColumn>("models");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedModelLabel, setSelectedModelLabel] = useState("");
  const [selectedGroupModelIds, setSelectedGroupModelIds] = useState<string[]>(
    []
  );
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);

  const sourceOptions = useMemo(() => {
    if (selectedModelId === null) return [];
    const modelIds =
      selectedGroupModelIds.length > 0
        ? selectedGroupModelIds
        : [selectedModelId];
    return buildSourceOptions(modelIds, accounts, isCliAgent);
  }, [accounts, isCliAgent, selectedModelId, selectedGroupModelIds]);

  useEffect(() => {
    if (!isOpen) return;

    const frameId = requestAnimationFrame(() => {
      setSelectedSourceIndex(0);
      if (isCliAgent && accountLookupSize === 0) {
        setActiveColumn("sources");
        setSelectedModelId("");
        setSelectedModelLabel("");
        setSelectedGroupModelIds([]);
      } else {
        setActiveColumn("models");
        setSelectedModelId(null);
        setSelectedModelLabel("");
        setSelectedGroupModelIds([]);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [isOpen, isCliAgent, accountLookupSize]);

  const applySourceSelection = useCallback(
    (modelId: string, _modelLabel: string, source: SourceOption) => {
      const resolvedModelId = modelId || advancedConfig.model || "";
      onConfigChange({
        ...advancedConfig,
        keySource: KEY_SOURCE.OWN,
        selectedAccountId: source.accountId,
        agent: source.modelType,
        provider: source.modelType,
        model: resolvedModelId,
        nativeHarnessType: source.nativeHarnessType,
        selectedSourceLabel: source.label,
        selectedSourceModelType: source.modelType,
      });
      recordRecent({
        modelId: resolvedModelId,
        sourceType: source.type,
        accountId: source.accountId,
        accountName: source.label,
        modelType: source.modelType,
      });
      onClose();
    },
    [advancedConfig, onConfigChange, onClose, recordRecent]
  );

  const previewModel = useCallback(
    (modelId: string | null, modelLabel: string, groupModelIds: string[]) => {
      setSelectedModelId(modelId);
      setSelectedModelLabel(modelId ? modelLabel : "");
      setSelectedGroupModelIds(modelId ? groupModelIds : []);
      setSelectedSourceIndex(0);
    },
    []
  );

  const handleModelPreview = useCallback(
    (modelId: string, modelLabel: string, groupModelIds: string[]) => {
      previewModel(modelId, modelLabel, groupModelIds);
    },
    [previewModel]
  );

  const handleModelSelect = useCallback(
    (modelId: string, modelLabel: string, groupModelIds: string[]) => {
      previewModel(modelId, modelLabel, groupModelIds);
      setActiveColumn("sources");
    },
    [previewModel]
  );

  const resolveLaunchModelForSource = useCallback(
    (source: SourceOption): string | null => {
      if (!selectedModelId) return null;
      const sourceAccount = source.accountId
        ? accounts.find((account) => account.id === source.accountId)
        : undefined;
      const candidateModelIds =
        selectedGroupModelIds.length > 0
          ? selectedGroupModelIds
          : [selectedModelId];
      const accountModelIds = sourceAccount
        ? candidateModelIds.filter((modelId) =>
            accountHasModel(sourceAccount, modelId)
          )
        : [];
      if (accountModelIds.length === 0) return selectedModelId;

      const selectedVariant = parseModelVariant(selectedModelId);
      const baseModel = selectedVariant?.baseModel ?? selectedModelId;
      const persisted = (sourceAccount?.defaultVariants ?? []).find(
        (entry) =>
          entry.base_model === baseModel &&
          accountModelIds.includes(entry.model)
      )?.model;
      const variantInfos = accountModelIds.map((modelId) =>
        resolveModelVariantFields(modelId)
      );
      return (
        resolveDefaultVariant(baseModel, variantInfos, persisted) ??
        accountModelIds[0]
      );
    },
    [accounts, selectedModelId, selectedGroupModelIds]
  );

  const handleSourceSelect = useCallback(
    (source: SourceOption) => {
      const launchModelId = resolveLaunchModelForSource(source);
      if (!launchModelId) return;
      applySourceSelection(launchModelId, selectedModelLabel, source);
    },
    [selectedModelLabel, applySourceSelection, resolveLaunchModelForSource]
  );

  const handleRecentSelect = useCallback(
    (entry: RecentModelEntry) => {
      const currentAccount = accounts.find(
        (account) =>
          account.id === entry.accountId &&
          account.status === "ready" &&
          account.hasKey &&
          accountHasModel(account, entry.modelId)
      );
      const reboundAccount =
        currentAccount ??
        accounts.find(
          (account) =>
            account.name === entry.accountName &&
            account.modelType === entry.modelType &&
            account.status === "ready" &&
            account.hasKey &&
            accountHasModel(account, entry.modelId)
        );

      if (!reboundAccount) {
        return;
      }

      const reboundEntry: RecentModelEntry = {
        ...entry,
        accountId: reboundAccount.id,
        accountName: reboundAccount.name,
        modelType: reboundAccount.modelType,
      };

      onConfigChange({
        ...advancedConfig,
        keySource: KEY_SOURCE.OWN,
        selectedAccountId: reboundAccount.id,
        agent: reboundAccount.modelType,
        provider: reboundAccount.modelType,
        model: reboundEntry.modelId,
        nativeHarnessType: reboundAccount.nativeHarnessType,
        selectedSourceLabel: reboundAccount.name,
        selectedSourceModelType: reboundAccount.modelType,
      });

      recordRecent(reboundEntry);
      onClose();
    },
    [accounts, advancedConfig, onConfigChange, onClose, recordRecent]
  );

  const handleBack = useCallback(() => {
    setActiveColumn("models");
  }, []);

  return {
    activeColumn,
    setActiveColumn,
    selectedModelId,
    selectedGroupModelIds,
    selectedSourceIndex,
    setSelectedSourceIndex,
    sourceOptions,
    previewModel,
    handleModelPreview,
    handleModelSelect,
    handleSourceSelect,
    handleRecentSelect,
    handleBack,
  };
}
