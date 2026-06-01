import React from "react";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

interface EmptyWorkflowStateProps {
  onAddAction?: () => void;
}

export const EmptyWorkflowState: React.FC<EmptyWorkflowStateProps> = () => {
  return (
    <Placeholder
      variant="empty"
      placement="detail-panel"
      title="No actions yet"
      subtitle="Select an action from the panel to get started."
    />
  );
};
