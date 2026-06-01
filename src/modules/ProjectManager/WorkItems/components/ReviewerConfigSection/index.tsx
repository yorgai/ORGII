import { useAtomValue } from "jotai";
import React from "react";

import type {
  OrchestratorConfig,
  ReviewConfig,
  ReviewerRefType,
} from "@src/api/http/project";
import { builtInAgentsAtom } from "@src/modules/MainApp/AgentOrgs/store/builtInAgentsAtom";
import type { AgentDefinition } from "@src/modules/MainApp/AgentOrgs/types";

const REVIEWER_TYPE_OPTIONS: ReviewerRefType[] = [
  "self_review",
  "agent",
  "human",
];

const REVIEWER_TYPE_LABEL_KEYS: Record<ReviewerRefType, string> = {
  self_review: "workItems.agentSettings.reviewerSelfReview",
  agent: "workItems.agentSettings.reviewerAgent",
  human: "workItems.agentSettings.reviewerHuman",
  org: "workItems.agentSettings.reviewerAgent",
};

interface ReviewerConfigSectionProps {
  config: OrchestratorConfig;
  onUpdateConfig: (updates: Partial<OrchestratorConfig>) => void;
  availableAgents: AgentDefinition[];
  t: (key: string) => string;
}

const ReviewerConfigSection: React.FC<ReviewerConfigSectionProps> = ({
  config,
  onUpdateConfig,
  availableAgents,
  t,
}) => {
  const builtInAgents = useAtomValue(builtInAgentsAtom);

  const reviewConfig: ReviewConfig = config.review_config ?? {
    reviewer: { type: "self_review" },
    max_rounds: 3,
  };

  const handleReviewerTypeChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const newType = event.target.value as ReviewerRefType;
    onUpdateConfig({
      review_config: {
        ...reviewConfig,
        reviewer: { type: newType, id: undefined },
      },
    });
  };

  const handleAgentSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onUpdateConfig({
      review_config: {
        ...reviewConfig,
        reviewer: { type: "agent", id: event.target.value || undefined },
      },
    });
  };

  const handleMaxRoundsChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = Math.max(1, Math.min(10, Number(event.target.value) || 1));
    onUpdateConfig({
      review_config: { ...reviewConfig, max_rounds: value },
    });
  };

  const allAgents = [
    ...builtInAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
    })),
    ...availableAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
    })),
  ];

  return (
    <div className="space-y-2 rounded-md bg-fill-1 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-3">
          {t("workItems.agentSettings.reviewerType")}
        </span>
        <select
          value={reviewConfig.reviewer.type}
          onChange={handleReviewerTypeChange}
          className="rounded border border-border-2 bg-bg-2 px-2 py-0.5 text-[11px] text-text-1"
        >
          {REVIEWER_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {t(REVIEWER_TYPE_LABEL_KEYS[type])}
            </option>
          ))}
        </select>
      </div>
      {reviewConfig.reviewer.type === "agent" && allAgents.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-3">Agent</span>
          <select
            value={reviewConfig.reviewer.id ?? ""}
            onChange={handleAgentSelect}
            className="max-w-[140px] truncate rounded border border-border-2 bg-bg-2 px-2 py-0.5 text-[11px] text-text-1"
          >
            <option value="">—</option>
            {allAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-text-3">
          {t("workItems.agentSettings.maxReviewRounds")}
        </span>
        <input
          type="number"
          min={1}
          max={10}
          value={reviewConfig.max_rounds}
          onChange={handleMaxRoundsChange}
          className="w-14 rounded border border-border-2 bg-bg-2 px-2 py-0.5 text-center text-[11px] text-text-1"
        />
      </div>
    </div>
  );
};

export default ReviewerConfigSection;
