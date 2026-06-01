/**
 * SearchAdapter — renders grep / symbol search hits via
 * `SearchBlock`. The block is header-only, so we only resolve the
 * display pattern and the lifecycle label here.
 */
import React from "react";

import { extractSearchData } from "@src/engines/SessionCore/rendering/props/propsDataExtractors";
import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import SearchBlock from "../../blocks/SearchBlock";

export const SearchAdapter: React.FC<UniversalEventProps> = (props) => {
  const searchAction = (props.args?.action as string) || undefined;
  const labels = useLifecycleLabels(props.eventType, searchAction);
  const state = statusToLifecycle(props.status);

  // Failed searches have no useful output for the user — suppress the row.
  if (state === "failed") return null;

  const { query } = extractSearchData(props);
  const title =
    labels[state] ||
    getToolDisplayLabelFromRegistry(props.eventType, searchAction);
  const toolName = props.functionName || props.eventType;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <SearchBlock
        pattern={query}
        isLoading={
          props.status === "running" && props.showActiveEventPainting === true
        }
        eventId={props.eventId}
        action={searchAction}
        title={title}
      />
    </div>
  );
};

SearchAdapter.displayName = "SearchAdapter";

export default SearchAdapter;
