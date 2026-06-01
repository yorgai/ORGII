/**
 * Provider + variant selection option builders for ApiSetup.
 *
 * These functions take already-loaded data from useProviderRegistry hook.
 * They do NOT fetch data themselves — the caller must provide the data.
 */
import type { TFunction } from "i18next";
import { KeyRound } from "lucide-react";
import React from "react";

import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import type { ModelType } from "@src/api/types/keys";
import ModelIcon from "@src/components/ModelIcon";
import {
  type IconProvider,
  getIconProvider,
} from "@src/components/ModelIcon/config";
import type { SelectOption } from "@src/components/Select";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import type { SelectionGridOption } from "@src/scaffold/WizardSystem/primitives";

import type { UnifiedProvider, UnifiedProviderVariant } from "../config";

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
  if (provider.key === "openai" && variant.modelType === CLI_AGENT.CODEX) {
    return t("wizard.variantCodex", "Codex");
  }
  if (variant.mode === "api_key") {
    return t("wizard.variantApiKey", "API Key");
  }
  return variant.label;
}

function variantIconElement(variant: UnifiedProviderVariant): React.ReactNode {
  if (variant.mode === "api_key") {
    return null;
  }
  return (
    <ModelIcon
      provider={getIconProvider(variant.modelType as ModelType)}
      size={20}
    />
  );
}

function variantIconNode(
  variant: UnifiedProviderVariant,
  size: number
): React.ReactNode {
  if (variant.mode === "api_key") {
    return <KeyRound size={size} className="shrink-0 text-text-3" />;
  }
  return (
    <ModelIcon
      provider={getIconProvider(variant.modelType as ModelType)}
      size={size}
    />
  );
}

export function buildProviderGridOptions(
  providers: UnifiedProvider[]
): SelectionGridOption[] {
  return providers.map((provider) => ({
    key: provider.key,
    label: provider.label,
    iconElement: (
      <ModelIcon provider={provider.iconProvider as IconProvider} size={18} />
    ),
  }));
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
      ...(variant.mode === "api_key"
        ? { icon: KeyRound }
        : {
            iconElement: variantIconElement(variant),
            iconPreserveColor: true,
          }),
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
