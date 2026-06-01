import React, { memo } from "react";

import type { WorkstationTabHeaderSlots } from "@src/store/workstation";

interface WorkstationTabHeaderSlotsViewProps {
  slots: WorkstationTabHeaderSlots | null;
}

export const WorkstationTabHeaderSlotsView: React.FC<WorkstationTabHeaderSlotsViewProps> =
  memo(({ slots }) => {
    return (
      <div className="flex min-w-0 flex-1 items-center">
        {slots?.leading && (
          <div className="flex shrink-0 items-center">{slots.leading}</div>
        )}
        <div className="flex min-w-0 flex-1 items-center">{slots?.content}</div>
        {slots?.trailing && (
          <div className="flex shrink-0 items-center gap-px">
            {slots.trailing}
          </div>
        )}
      </div>
    );
  });

WorkstationTabHeaderSlotsView.displayName = "WorkstationTabHeaderSlotsView";
