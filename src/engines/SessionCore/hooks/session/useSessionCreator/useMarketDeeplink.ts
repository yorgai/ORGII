import { useEffect, useRef } from "react";

import type {
  CliAgentType,
  ModelType,
} from "@src/api/tauri/rpc/schemas/validation";
import { KEY_SOURCE } from "@src/api/tauri/session";
import type { RecentModelEntry } from "@src/store/session/recentModelEntriesAtom";

interface UseMarketDeeplinkOptions {
  setLastModelSelection: (entry: RecentModelEntry) => void;
}

/**
 * One-shot effect: reads market URL params on mount and applies a model
 * selection deeplink. Cleans up the URL params after applying.
 */
export function useMarketDeeplink({
  setLastModelSelection,
}: UseMarketDeeplinkOptions): void {
  const deepLinkAppliedRef = useRef(false);

  useEffect(() => {
    if (deepLinkAppliedRef.current) return;

    const urlParams = new URLSearchParams(window.location.search);
    const cliAgentTypeParam = urlParams.get("cliAgentType");
    if (!cliAgentTypeParam) return;

    deepLinkAppliedRef.current = true;

    const modelParam = urlParams.get("model");
    const tierParam = urlParams.get("tier") || "basic";
    const agentType = (urlParams.get("agentType") ||
      cliAgentTypeParam) as CliAgentType;
    const listingName = urlParams.get("listingName");
    const displayName =
      listingName || modelParam || agentType || "Cloud Provider";

    const deeplinkPair: RecentModelEntry = {
      modelId: modelParam || tierParam,
      sourceType: KEY_SOURCE.HOSTED,
      accountName: displayName,
      modelType: agentType as unknown as ModelType,
    };
    setLastModelSelection(deeplinkPair);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("cliAgentType");
    cleanUrl.searchParams.delete("model");
    cleanUrl.searchParams.delete("tier");
    cleanUrl.searchParams.delete("agentType");
    cleanUrl.searchParams.delete("listingName");
    cleanUrl.searchParams.delete("priceInfo");
    window.history.replaceState({}, "", cleanUrl.toString());
  }, [setLastModelSelection]);
}
