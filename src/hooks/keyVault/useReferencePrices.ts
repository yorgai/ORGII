/**
 * useReferencePrices — OSS stub.
 *
 * Reference prices are empty in the OSS build (no hosted backend), and the
 * agent-pricing helpers return token-based defaults. The KeyVault wizard's
 * Step 2 leaves the model list empty when validation returns no models and
 * lets the user enter custom models manually — no fallback to a tunables
 * list.
 */
import { useCallback, useMemo } from "react";

import type { ModelType } from "@src/api/types/keys";

export interface ReferencePriceEntry {
  input: number;
  output: number;
  cache_write?: number;
  cache_read?: number;
  description: string;
}

export interface ReferencePriceMap {
  [model: string]: ReferencePriceEntry;
}

interface AgentPricingConfig {
  agent_type: string;
  pricing_model: "per_token" | "per_credit";
  price_per_credit?: number;
}

export interface UseReferencePricesReturn {
  referencePrices: ReferencePriceMap;
  agentConfigs: AgentPricingConfig[];
  agentModels: string[];
  getCreditPrice: (agentType: ModelType) => number | undefined;
  getPricingModel: (agentType: ModelType) => "per_token" | "per_credit";
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EMPTY_PRICES: ReferencePriceMap = {};
const EMPTY_AGENT_CONFIGS: AgentPricingConfig[] = [];
const EMPTY_AGENT_MODELS: string[] = [];

export function useReferencePrices(
  _agentType?: string
): UseReferencePricesReturn {
  const refresh = useCallback(async () => {
    /* no-op */
  }, []);
  const getCreditPrice = useCallback(() => undefined, []);
  const getPricingModel = useCallback(
    (): "per_token" | "per_credit" => "per_token",
    []
  );

  return useMemo(
    () => ({
      referencePrices: EMPTY_PRICES,
      agentConfigs: EMPTY_AGENT_CONFIGS,
      agentModels: EMPTY_AGENT_MODELS,
      getCreditPrice,
      getPricingModel,
      loading: false,
      error: null,
      refresh,
    }),
    [getCreditPrice, getPricingModel, refresh]
  );
}

export default useReferencePrices;
