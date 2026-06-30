/**
 * Provider + variant selection option builders for ApiSetup.
 *
 * These functions take already-loaded data from useProviderRegistry hook.
 * They do NOT fetch data themselves — the caller must provide the data.
 */
import type { TFunction } from "i18next";
import { Calendar, Cog, KeyRound } from "lucide-react";
import React from "react";

import ModelIcon from "@src/components/ModelIcon";
import { type IconProvider } from "@src/components/ModelIcon/config";
import type { SelectOption } from "@src/components/Select";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { SelectionGridOption } from "@src/scaffold/WizardSystem/primitives";

import type {
  ProviderGroup,
  UnifiedProvider,
  UnifiedProviderVariant,
} from "../config";

/** Custom filter for JSX-labelled options — searches against extra.searchText */
export function filterOptionBySearchText(
  inputValue: string,
  option: SelectOption
): boolean {
  const searchText =
    (option.extra as { searchText?: string } | undefined)?.searchText ??
    String(option.value);
  return searchText.toLowerCase().includes(inputValue.toLowerCase());
}

export function resolveVariantLabel(
  variant: UnifiedProviderVariant,
  provider: UnifiedProvider | undefined,
  t: TFunction
): string {
  if (!provider) return variant.label;
  if (variant.mode === "api_key") {
    return t("wizard.variantApiKey", "API Key");
  }
  return t("wizard.variantSubscription", "Subscription");
}

function variantIconNode(
  variant: UnifiedProviderVariant,
  size: number
): React.ReactNode {
  if (variant.mode === "api_key") {
    return <KeyRound size={size} className="shrink-0 text-text-3" />;
  }
  return <Calendar size={size} className="shrink-0 text-text-3" />;
}

export interface ProviderGridOptionGroup {
  group: ProviderGroup;
  options: SelectionGridOption[];
}

function buildProviderGridOption(
  provider: UnifiedProvider
): SelectionGridOption {
  return {
    key: provider.key,
    label: provider.label,
    iconElement:
      provider.iconElement === "cog" ? (
        <Cog size={18} className="shrink-0 text-text-3" />
      ) : (
        <ModelIcon provider={provider.iconProvider as IconProvider} size={18} />
      ),
    iconPreserveColor: provider.iconElement !== "cog",
  };
}

export function buildProviderGridOptionGroups(
  providers: UnifiedProvider[]
): ProviderGridOptionGroup[] {
  const groups: ProviderGridOptionGroup[] = [];
  for (const group of ["cloud", "local"] as ProviderGroup[]) {
    const options = providers
      .filter((provider) => provider.group === group)
      .map(buildProviderGridOption);
    if (options.length > 0) groups.push({ group, options });
  }
  return groups;
}

export function buildProviderSelectOptions(
  providers: UnifiedProvider[]
): SelectOption[] {
  return providers.map((provider) => ({
    value: provider.key,
    label: (
      <span className="flex items-center gap-2">
        <ModelIcon provider={provider.iconProvider as IconProvider} size={16} />
        {provider.label}
      </span>
    ),
    triggerLabel: (
      <span className="flex items-center gap-2">
        <ModelIcon provider={provider.iconProvider as IconProvider} size={16} />
        {provider.label}
      </span>
    ),
    extra: { searchText: provider.label },
  }));
}

export function buildVariantGridOptions(
  selectedProvider: UnifiedProvider | undefined,
  t: TFunction
): SelectionGridOption[] {
  if (!selectedProvider || selectedProvider.variants.length <= 1) return [];
  return selectedProvider.variants.map((variant) => {
    const label = resolveVariantLabel(variant, selectedProvider, t);
    return {
      key: variant.modelType,
      label,
      icon: variant.mode === "api_key" ? KeyRound : Calendar,
    };
  });
}

export function buildVariantSelectOptions(
  selectedProvider: UnifiedProvider | undefined,
  t: TFunction
): SelectOption[] {
  if (!selectedProvider || selectedProvider.variants.length <= 1) return [];
  return selectedProvider.variants.map((variant) => {
    const label = resolveVariantLabel(variant, selectedProvider, t);
    const icon = variantIconNode(variant, 16);
    const labelNode = (
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
    );
    return {
      value: variant.modelType,
      label: labelNode,
      triggerLabel: labelNode,
      extra: { searchText: label },
    };
  });
}

/** Provider filter for Keys table — one row per brand (e.g. OpenAI covers API + Codex). */
export function buildBrandProviderFilterOptions(
  accounts: KeyVaultAccount[],
  unifiedProviders: UnifiedProvider[],
  modelTypeToProviderKey: Record<string, string>,
  t: TFunction
): SelectOption[] {
  const brandKeysWithAccounts = new Set<string>();
  for (const account of accounts) {
    const brandKey =
      modelTypeToProviderKey[account.modelType] ?? account.modelType;
    brandKeysWithAccounts.add(brandKey);
  }

  const providers = unifiedProviders
    .filter((provider) => brandKeysWithAccounts.has(provider.key))
    .sort((providerA, providerB) =>
      providerA.label.localeCompare(providerB.label)
    );

  return [
    {
      value: "all",
      label: t("keyVault.filterAllProviders"),
    },
    ...providers.map((provider) => {
      const labelNode = (
        <span className="flex items-center gap-2">
          <ModelIcon
            provider={provider.iconProvider as IconProvider}
            size={16}
          />
          {provider.label}
        </span>
      );
      return {
        value: provider.key,
        label: labelNode,
        triggerLabel: labelNode,
        extra: { searchText: provider.label },
      };
    }),
  ];
}

export function accountMatchesBrandFilter(
  account: KeyVaultAccount,
  brandKey: string,
  modelTypeToProviderKey: Record<string, string>
): boolean {
  return (
    (modelTypeToProviderKey[account.modelType] ?? account.modelType) ===
    brandKey
  );
}
