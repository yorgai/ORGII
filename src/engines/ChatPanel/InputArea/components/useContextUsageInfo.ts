import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import type { ContextUsageSnapshot } from "@src/store/session/cliSessionStatusAtom";
import {
  sessionContextTokensAtom,
  sessionContextUsageAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getModelInfo } from "@src/util/modelInfo";

export interface ContextUsageInfo {
  percentage: number;
  clampedPercentage: number;
  tokenLabel: string;
  maxTokens: number;
  contextUsage: ContextUsageSnapshot | null;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

export function useContextUsageInfo(): ContextUsageInfo {
  const { t } = useTranslation();
  const sessionTokens = useAtomValue(sessionContextTokensAtom);
  const contextUsage = useAtomValue(sessionContextUsageAtom);
  const lastModel = useValidatedLastPair();

  const modelName = lastModel?.model || lastModel?.listingModel || "";
  const modelInfo = useMemo(
    () => (modelName ? getModelInfo(modelName) : null),
    [modelName]
  );
  const contextWindowK = modelInfo?.contextWindow ?? 200;
  const modelMaxTokens = contextWindowK * 1000;
  const maxTokens = contextUsage?.maxTokens ?? modelMaxTokens;
  const snapshotTokens = contextUsage?.usedTokens ?? 0;
  const displayTokens = sessionTokens > 0 ? sessionTokens : snapshotTokens;
  const hasFreshSnapshot = contextUsage?.usedTokens === displayTokens;
  const percentage =
    hasFreshSnapshot && contextUsage?.percentUsed != null
      ? contextUsage.percentUsed
      : maxTokens > 0
        ? (displayTokens / maxTokens) * 100
        : 0;
  const clampedPercentage = Math.min(percentage, 100);

  const tokenLabel = `${clampedPercentage.toFixed(1)}% · ${formatTokenCount(displayTokens)} / ${formatTokenCount(maxTokens)} ${t("contextInfo.contextUsed")}`;

  return {
    percentage,
    clampedPercentage,
    tokenLabel,
    maxTokens,
    contextUsage,
  };
}
