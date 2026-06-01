import React from "react";
import { useTranslation } from "react-i18next";

import SessionOutputPreview from "../SessionOutputPreview";
import { STATUS_I18N_KEYS, getStatusStyle } from "../types";

interface SubAgentRunCardProps {
  sessionId: string;
  agentName: string;
  instanceNumber: number;
  status: string;
  isActive: boolean;
  totalTokens?: number;
}

const SubAgentRunCard: React.FC<SubAgentRunCardProps> = ({
  sessionId,
  agentName,
  instanceNumber,
  status,
  isActive,
  totalTokens,
}) => {
  const { t } = useTranslation("projects");
  const style = getStatusStyle(status);
  const StatusIcon = style.icon;

  return (
    <div className="overflow-hidden rounded-md bg-bg-2">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <StatusIcon size={12} className={style.iconClass} />
        <span className="text-[11px] font-medium text-text-1">
          {agentName} #{instanceNumber}
        </span>
        <span
          className={`rounded-full px-1.5 py-px text-[9px] font-medium leading-[14px] ${style.badgeClass}`}
        >
          {STATUS_I18N_KEYS[status] ? t(STATUS_I18N_KEYS[status]) : status}
        </span>
        {totalTokens != null && totalTokens > 0 && (
          <span className="ml-auto text-[10px] tabular-nums text-text-4">
            {totalTokens.toLocaleString()} {t("workItems.agentWorkflow.tokens")}
          </span>
        )}
      </div>
      <div className="px-2.5 pb-1.5">
        <SessionOutputPreview
          sessionId={sessionId}
          isRunning={isActive}
          defaultCollapsed={!isActive}
        />
      </div>
    </div>
  );
};

export default SubAgentRunCard;
