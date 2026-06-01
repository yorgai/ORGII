import { useAtom } from "jotai";
import React, { memo, useCallback } from "react";

import {
  OPS_CONTROL_SESSION_CREATOR_OVERLAY_CLASS,
  OPS_CONTROL_SESSION_CREATOR_SURFACE_CLASS,
} from "@src/config/opsControlCardTokens";
import { SessionCreatorFactory } from "@src/features/SessionCreator/variants";
import { agentKanbanCreatorVisibleAtom } from "@src/store/ui/agentKanbanCreatorAtom";

const OpsControlTaskCreator: React.FC = memo(() => {
  const [visible, setVisible] = useAtom(agentKanbanCreatorVisibleAtom);

  const handleClose = useCallback(() => {
    setVisible(false);
  }, [setVisible]);

  if (!visible) return null;

  return (
    <div className={OPS_CONTROL_SESSION_CREATOR_OVERLAY_CLASS}>
      <SessionCreatorFactory
        className={OPS_CONTROL_SESSION_CREATOR_SURFACE_CLASS}
        onSessionStart={handleClose}
        onClose={handleClose}
      />
    </div>
  );
});

OpsControlTaskCreator.displayName = "OpsControlTaskCreator";

export default OpsControlTaskCreator;
