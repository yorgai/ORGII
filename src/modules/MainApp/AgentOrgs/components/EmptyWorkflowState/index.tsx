import React from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

interface EmptyWorkflowStateProps {
  onAddAction?: () => void;
}

export const EmptyWorkflowState: React.FC<EmptyWorkflowStateProps> = () => {
  const { t } = useTranslation("integrations");

  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      title={t("workflowActions.inline.emptyTitle")}
      subtitle={t("workflowActions.inline.emptySubtitle")}
    />
  );
};
