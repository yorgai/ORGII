import React from "react";

import { WorkItemContent } from "@src/modules/ProjectManager/WorkItems/components";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanelAtom";

interface WorkItemPanelViewProps {
  selectedWorkItem: ChatPanelSelectedWorkItem;
}

export const WorkItemPanelView: React.FC<WorkItemPanelViewProps> = ({
  selectedWorkItem,
}) => {
  const workItemContentKey = `${selectedWorkItem.projectSlug}:${
    selectedWorkItem.shortId || selectedWorkItem.workItem.session_id
  }`;

  return (
    <WorkItemContent
      key={workItemContentKey}
      workItem={selectedWorkItem.workItem}
      projectSlug={selectedWorkItem.projectSlug}
      shortId={selectedWorkItem.shortId}
    />
  );
};

export default WorkItemPanelView;
