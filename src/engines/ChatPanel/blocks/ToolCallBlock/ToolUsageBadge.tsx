import React from "react";
import { useTranslation } from "react-i18next";

import { TOOL_USAGE_ATTRIBUTION_METHOD } from "@src/api/tauri/session";
import type { ToolUsageMetadata } from "@src/engines/SessionCore/core/types";

interface ToolUsageBadgeProps {
  usage: ToolUsageMetadata;
}

export function formatToolUsageTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return `${value.toFixed(value >= 10 ? 0 : 1)}k`;
  }
  return String(tokens);
}

function isEstimated(method: string): boolean {
  return method !== TOOL_USAGE_ATTRIBUTION_METHOD.PROVIDER_EXACT;
}

const ToolUsageBadge: React.FC<ToolUsageBadgeProps> = ({ usage }) => {
  const { t } = useTranslation("sessions");
  const contextTokens = usage.resultContextTokens;
  const followupTokens = usage.followupCompletionTokens;
  const decisionTokens = usage.decisionCompletionTokens;
  const primaryTokens = contextTokens || followupTokens || decisionTokens;

  if (primaryTokens <= 0) return null;

  const label = formatToolUsageTokenCount(primaryTokens);

  const title = t("toolUsage.tooltip", {
    method: usage.attributionMethod,
    inputBytes: usage.inputBytes,
    outputBytes: usage.outputBytes,
    decisionTokens: usage.decisionCompletionTokens,
    contextTokens: usage.resultContextTokens,
    followupTokens: usage.followupCompletionTokens,
    cacheReadTokens: usage.relatedCacheReadTokens,
    cacheWriteTokens: usage.relatedCacheWriteTokens,
  });

  return (
    <span
      className="border-border/60 bg-muted/50 text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
      title={title}
    >
      {isEstimated(usage.attributionMethod) && (
        <span className="mr-0.5">~</span>
      )}
      {label}
    </span>
  );
};

export default React.memo(ToolUsageBadge);
