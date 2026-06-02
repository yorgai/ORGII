import React from "react";

import ModelIcon from "@src/components/ModelIcon";
import type { KeyVaultAccount } from "@src/hooks/keyVault/types";
import { getModelAliasDisplayName } from "@src/hooks/models/modelAliasRegistry";
import { accountHasModel } from "@src/hooks/models/useModelAccountLookup";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";
import {
  compareModelsByVersion,
  formatModelNameFull,
} from "@src/util/formatModelName";
import { groupModels } from "@src/util/modelGrouping";
import { parseModelVariant } from "@src/util/modelVariants";

import type { SpotlightItem } from "../../types";
import { VariantPill } from "./VariantPill";
import { MODEL_SECTION, type ModelSection } from "./modelSection";

interface BuildModelSelectionRowParams {
  entry: RecentModelEntry;
  section: ModelSection;
  idPrefix: string;
  isCurrentSelection: boolean;
  accounts: KeyVaultAccount[];
  groupByModel: Map<string, readonly string[]>;
  onSelect: (entry: RecentModelEntry) => void;
  persistDefaultVariantForAccount: (
    accountId: string,
    baseModel: string,
    modelId: string
  ) => void;
  modelAliasVersion: number;
}

export function buildModelSelectionSpotlightItem({
  entry,
  section,
  idPrefix,
  isCurrentSelection,
  accounts,
  groupByModel,
  onSelect,
  persistDefaultVariantForAccount,
  modelAliasVersion,
}: BuildModelSelectionRowParams): SpotlightItem {
  void modelAliasVersion;
  const aliasDisplayName = getModelAliasDisplayName(entry.modelId);
  const modelDisplay = aliasDisplayName ?? formatModelNameFull(entry.modelId);
  const sourceName = entry.accountName ?? entry.modelType;
  const searchableLabel = `${sourceName} ${modelDisplay}`;

  const selectedTextClassName = isCurrentSelection
    ? "text-primary-6"
    : "text-text-1";
  const selectedMutedTextClassName = isCurrentSelection
    ? "text-primary-6"
    : "text-text-2";
  const selectedDividerClassName = isCurrentSelection
    ? "text-primary-6"
    : "text-text-3";

  const labelContent = aliasDisplayName ? (
    <>
      <span className={`shrink-0 ${selectedMutedTextClassName}`}>
        {sourceName}
      </span>
      <span className={`mx-0.5 shrink-0 ${selectedDividerClassName}`}>›</span>
      <ModelIcon modelName={entry.modelId} size={14} />
      <span className={`shrink-0 font-semibold ${selectedTextClassName}`}>
        {modelDisplay}
      </span>
      <span
        className={`ml-1.5 min-w-0 truncate text-[12px] ${selectedMutedTextClassName}`}
      >
        {entry.modelId}
      </span>
    </>
  ) : (
    <>
      <span className={selectedMutedTextClassName}>{sourceName}</span>
      <span className={`mx-0.5 ${selectedDividerClassName}`}>›</span>
      <ModelIcon modelName={entry.modelId} size={14} />
      <span className={`font-semibold ${selectedTextClassName}`}>
        {modelDisplay}
      </span>
    </>
  );

  const AccountListIcon = (iconProps: Record<string, unknown>) => {
    const size = (iconProps as { size?: number }).size || 16;
    return <ModelIcon agentType={entry.modelType} size={size} />;
  };

  const recentAccount = entry.accountId
    ? accounts.find((account) => account.id === entry.accountId)
    : undefined;
  const family = groupByModel.get(entry.modelId) ?? [entry.modelId];
  const accountFamilyIds = recentAccount
    ? family.filter((modelId) => accountHasModel(recentAccount, modelId))
    : [entry.modelId];

  const variant = parseModelVariant(entry.modelId);
  const previewBaseModel = variant?.baseModel;
  const handleApply =
    recentAccount && previewBaseModel
      ? (nextModelId: string) =>
          persistDefaultVariantForAccount(
            recentAccount.id,
            previewBaseModel,
            nextModelId
          )
      : undefined;

  const accountHasMultipleVariants = accountFamilyIds.length > 1;
  const trailing: React.ReactNode =
    variant && accountHasMultipleVariants ? (
      <VariantPill
        modelId={entry.modelId}
        groupModelIds={accountFamilyIds}
        onApply={handleApply}
      />
    ) : (
      <VariantPill modelId={variant?.baseModel ?? entry.modelId} />
    );

  return {
    id: `${idPrefix}:${entry.modelId}:${entry.accountId ?? entry.sourceType}`,
    label: searchableLabel,
    icon: AccountListIcon,
    type: "action" as const,
    data: {
      isSelector: true,
      isCurrentSelection,
      modelSection: section,
      modelId: entry.modelId,
      groupModelIds: accountFamilyIds,
      labelContent,
      rightContent: trailing,
      searchAlias: aliasDisplayName ? entry.modelId : undefined,
    },
    action: () => onSelect(entry),
  };
}

interface BuildAllModelItemsParams {
  accountLookup: ReadonlyMap<string, unknown>;
  handleModelSelect: (
    modelId: string,
    modelLabel: string,
    groupModelIds: string[]
  ) => void;
  modelAliasVersion: number;
  resolveGroupLaunchModel: (sortedVariants: string[]) => string;
}

export function buildAllModelItems({
  accountLookup,
  handleModelSelect,
  modelAliasVersion,
  resolveGroupLaunchModel,
}: BuildAllModelItemsParams): SpotlightItem[] {
  void modelAliasVersion;

  const items: SpotlightItem[] = [];
  const modelIds = Array.from(accountLookup.keys());
  const groups = groupModels(modelIds);

  for (const group of groups) {
    const sortedVariants = [...group.models].sort(compareModelsByVersion);

    if (sortedVariants.length === 1) {
      const modelId = sortedVariants[0];
      const info = accountLookup.get(modelId);
      if (!info) continue;
      const aliasDisplayName = getModelAliasDisplayName(modelId);
      const displayLabel = aliasDisplayName ?? formatModelNameFull(modelId);

      void info;

      const ModelItemIcon = (iconProps: Record<string, unknown>) => (
        <ModelIcon
          modelName={modelId}
          size={(iconProps as { size?: number }).size || 16}
        />
      );

      const labelContent = aliasDisplayName ? (
        <>
          <span className="shrink-0 font-medium text-text-1">
            {displayLabel}
          </span>
          <span className="ml-1.5 min-w-0 truncate text-[12px] text-text-2">
            {modelId}
          </span>
        </>
      ) : undefined;

      items.push({
        id: modelId,
        label: displayLabel,
        icon: ModelItemIcon,
        type: "action" as const,
        data: {
          isSelector: true,
          modelSection: MODEL_SECTION.ALL,
          modelId,
          groupModelIds: [modelId],
          ...(labelContent ? { labelContent } : {}),
          searchAlias: aliasDisplayName ? modelId : undefined,
        },
        action: () => handleModelSelect(modelId, displayLabel, [modelId]),
      });
      continue;
    }

    const aliasParts: string[] = [];
    for (const modelId of sortedVariants) {
      const alias = getModelAliasDisplayName(modelId);
      if (alias) aliasParts.push(alias);
    }

    const representativeModel = sortedVariants[0];
    const GroupItemIcon = (iconProps: Record<string, unknown>) => (
      <ModelIcon
        modelName={representativeModel}
        size={(iconProps as { size?: number }).size || 16}
      />
    );

    const labelContent = (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 font-medium text-text-1">{group.label}</span>
      </span>
    );

    const searchableLabel = [
      group.label,
      ...aliasParts,
      ...sortedVariants,
    ].join(" ");

    const launchModel = resolveGroupLaunchModel(sortedVariants);

    items.push({
      id: `group:${group.label}:${group.sortVersion}`,
      label: searchableLabel,
      icon: GroupItemIcon,
      type: "action" as const,
      data: {
        isSelector: true,
        modelSection: MODEL_SECTION.ALL,
        modelId: launchModel,
        groupModelIds: sortedVariants,
        labelContent,
      },
      action: () =>
        handleModelSelect(
          launchModel,
          getModelAliasDisplayName(launchModel) ??
            formatModelNameFull(launchModel),
          sortedVariants
        ),
    });
  }

  return items;
}
