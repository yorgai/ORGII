import React from "react";
import { useTranslation } from "react-i18next";

import type { LlmUsageMetadata } from "@src/engines/SessionCore/core/types";

import { UsagePairBadge } from "./ToolUsageBadge";

interface LlmUsageBadgeProps {
  usage: LlmUsageMetadata;
}

const LlmUsageBadge: React.FC<LlmUsageBadgeProps> = ({ usage }) => {
  const { t } = useTranslation("sessions");
  const title = t("toolUsage.tooltip", {
    method: usage.attributionMethod,
    inputBytes: 0,
    outputBytes: 0,
    decisionTokens: usage.outputTokens,
    contextTokens: usage.inputTokens,
    followupTokens: 0,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  });

  return (
    <UsagePairBadge
      inputTokens={usage.inputTokens}
      outputTokens={usage.outputTokens}
      title={title}
    />
  );
};

export default React.memo(LlmUsageBadge);
