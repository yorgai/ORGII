/**
 * Resolve a model selection to display + tooltip labels, reactive to the
 * model-alias registry.
 *
 * Wraps `resolveModelDisplayLabel` / `resolveModelFullLabel` and subscribes
 * to `useModelAliasRegistryVersion` so the label refreshes whenever the user
 * edits a model alias in Key Vault. Use this from any pill/label that should
 * show the user-chosen alias instead of the raw model id.
 */
import { useMemo } from "react";

import {
  resolveModelDisplayLabel,
  resolveModelFullLabel,
  resolveModelPillAccountName,
  resolveModelPillLabel,
} from "@src/util/formatModelName";

import { useModelAliasRegistryVersion } from "./modelAliasRegistry";

interface ModelSelectionInput {
  model?: string;
  provider?: string;
  listingModel?: string;
  listingModelDisplay?: string;
  listingName?: string;
  selectedSourceLabel?: string;
  selectedSourceModelType?: string;
}

interface ProviderWithModels {
  provider_name: string;
  models: { id: string; display_name: string }[];
}

interface ResolvedModelLabel {
  /** Compact label for the pill body (alias > listing display > formatted id). */
  label: string;
  /** Full label for hover tooltips (alias > listing display > formatted id with date). */
  title: string;
  /** Key vault account or hosted listing name for breadcrumb tooltips. */
  accountName?: string;
}

export function useResolvedModelLabel(
  selection: ModelSelectionInput | null | undefined,
  providers: ProviderWithModels[],
  fallback: string = "Model"
): ResolvedModelLabel {
  const aliasVersion = useModelAliasRegistryVersion();

  return useMemo(() => {
    const sel = selection ?? {};
    return {
      label: resolveModelDisplayLabel(sel, providers, fallback),
      title: resolveModelFullLabel(sel, fallback),
    };
    // `aliasVersion` is read by the resolvers via the module-scope alias
    // registry; include it as a dep so the labels recompute when the user
    // edits an alias. eslint can't see the registry read, hence the
    // intentional "unnecessary" dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, providers, fallback, aliasVersion]);
}

export function useModelPillLabel(
  selection: ModelSelectionInput | null | undefined,
  fallback: string = "Model"
): ResolvedModelLabel {
  const aliasVersion = useModelAliasRegistryVersion();

  return useMemo(() => {
    const sel = selection ?? {};
    return {
      label: resolveModelPillLabel(sel, fallback),
      title: resolveModelFullLabel(sel, fallback),
      accountName: resolveModelPillAccountName(sel),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, fallback, aliasVersion]);
}
