/**
 * ReadFileAdapter — resolves the pre-translated lifecycle title without a
 * filename. `ReadFileBlock` renders the concrete file icon and file name
 * separately so the header reads like `Read [icon] name`.
 */
import React from "react";

import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";

import ReadFileBlock from "../../blocks/ReadFileBlock";

export const ReadFileAdapter: React.FC<UniversalEventProps> = (props) => {
  const labels = useLifecycleLabels(props.eventType);
  const state = statusToLifecycle(props.status);
  const toolName = props.functionName || props.eventType;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <ReadFileBlock {...props} title={labels[state]} />
    </div>
  );
};

ReadFileAdapter.displayName = "ReadFileAdapter";

export default ReadFileAdapter;
