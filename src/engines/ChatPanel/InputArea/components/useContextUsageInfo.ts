import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import type { ContextBreakdown } from "@src/store/session/cliSessionStatusAtom";
import {
  sessionContextBreakdownAtom,
  sessionContextTokensAtom,
} from "@src/store/session/cliSessionStatusAtom";
import { getModelInfo } from "@src/util/modelInfo";

export interface RuleTokenEstimate {
  name: string;
  estimatedTokens: number;
  source?: "global" | "workspace" | "personal";
}

export interface ContextUsageInfo {
  percentage: number;
  clampedPercentage: number;
  tokenLabel: string;
  rules: RuleTokenEstimate[];
  isPreview: boolean;
  /** Max context window in tokens for the current model */
  maxTokens: number;
  /**
   * Per-category token breakdown from the Rust backend.
   * Null until the first `agent:complete` with breakdown data arrives.
   */
  liveBreakdown: ContextBreakdown | null;
  /** Rules token total derived from policies_list (always live) */
  rulesTokens: number;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
}

interface PolicyListItem {
  name: string;
  enabled: boolean;
  estimatedTokens: number;
  source?: "global" | "workspace" | "personal";
}

interface RulesDataCache {
  key: string;
  rules: RuleTokenEstimate[];
}

export function filterContextRules(
  policies: PolicyListItem[]
): RuleTokenEstimate[] {
  return policies
    .filter((policy) => policy.enabled && policy.source !== "personal")
    .map((policy) => ({
      name: policy.name,
      estimatedTokens: policy.estimatedTokens,
      source: policy.source,
    }));
}

export function resolveRulesTokens(
  liveBreakdown: ContextBreakdown | null,
  estimatedRulesTokens: number
): number {
  return liveBreakdown?.rulesTokens ?? estimatedRulesTokens;
}

export function useContextUsageInfo(repoPath?: string): ContextUsageInfo {
  const { t } = useTranslation();
  const sessionTokens = useAtomValue(sessionContextTokensAtom);
  const liveBreakdown = useAtomValue(sessionContextBreakdownAtom);
  const lastModel = useValidatedLastPair();

  // Stale-cache guard: keyed by repoPath so switching workspaces always
  // triggers a fresh fetch, but the same path doesn't re-fetch.
  const [rulesCache, setRulesCache] = useState<RulesDataCache | null>(null);

  // Keep a ref to the latest repoPath to avoid stale-closure issues in
  // the async effect without adding repoPath as a memo dep everywhere.
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;

  const modelName = lastModel?.model || lastModel?.listingModel || "";
  const modelInfo = useMemo(
    () => (modelName ? getModelInfo(modelName) : null),
    [modelName]
  );
  const contextWindowK = modelInfo?.contextWindow ?? 200;
  const maxTokens = contextWindowK * 1000;

  // Only re-derive `rules` when the cache object itself changes (reference equality).
  const rules = useMemo(
    () => (rulesCache && rulesCache.key === repoPath ? rulesCache.rules : []),
    [rulesCache, repoPath]
  );

  const estimatedRulesTokens = useMemo(
    () => rules.reduce((sum, rule) => sum + rule.estimatedTokens, 0),
    [rules]
  );
  const rulesTokens = resolveRulesTokens(liveBreakdown, estimatedRulesTokens);

  const isPreview = sessionTokens === 0 && estimatedRulesTokens > 0;
  const displayTokens =
    sessionTokens > 0 ? sessionTokens : estimatedRulesTokens;
  const percentage = maxTokens > 0 ? (displayTokens / maxTokens) * 100 : 0;
  const clampedPercentage = Math.min(percentage, 100);

  const tokenLabel = isPreview
    ? `~${clampedPercentage.toFixed(1)}% · ~${formatTokenCount(rulesTokens)} / ${formatTokenCount(maxTokens)} ${t("contextInfo.estimatedFromRules")}`
    : `${clampedPercentage.toFixed(1)}% · ${formatTokenCount(sessionTokens)} / ${formatTokenCount(maxTokens)} ${t("contextInfo.contextUsed")}`;

  // Fetch rules only when repoPath actually changes.
  // Cancel in-flight fetches on repoPath change or unmount.
  useEffect(() => {
    if (!repoPath) {
      setRulesCache(null);
      return;
    }

    // Skip if we already have fresh data for this path.
    if (rulesCache?.key === repoPath) return;

    let cancelled = false;

    invoke<
      Array<{
        name: string;
        enabled: boolean;
        estimatedTokens: number;
        source?: "global" | "workspace" | "personal";
      }>
    >("policies_list", { workspacePath: repoPath })
      .then((result) => {
        if (cancelled) return;
        setRulesCache({ key: repoPath, rules: filterContextRules(result) });
      })
      .catch(() => {
        if (cancelled) return;
        setRulesCache({ key: repoPath, rules: [] });
      });

    return () => {
      cancelled = true;
    };
    // Intentionally omit rulesCache from deps: we only want to fetch when
    // repoPath changes, not when the cache updates (that would loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  return {
    percentage,
    clampedPercentage,
    tokenLabel,
    rules,
    isPreview,
    maxTokens,
    liveBreakdown,
    rulesTokens,
  };
}
