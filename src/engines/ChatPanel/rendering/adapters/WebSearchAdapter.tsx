/**
 * WebSearchAdapter — renders `web_search` results via `WebSearchBlock`.
 * Prefers `rustExtracted.kind === "webSearch"`; falls back to shallow
 * field picking on raw `args` / `result`.
 */
import React from "react";

import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import WebSearchBlock from "../../blocks/WebSearchBlock";

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function extractWebSearchData(props: UniversalEventProps) {
  if (props.rustExtracted?.kind === "webSearch") {
    const webSearchData = props.rustExtracted;
    if (webSearchData.query || webSearchData.results.length > 0) {
      return { query: webSearchData.query, results: webSearchData.results };
    }
  }

  const { args, result } = props;
  const query = (args?.query as string) || (args?.search_term as string) || "";
  const rawResults = (result?.results as unknown[]) || [];
  const results: WebSearchResult[] = rawResults.map((item) => {
    const obj = item as Record<string, unknown>;
    return {
      title: (obj.title as string) || "",
      url: (obj.url as string) || (obj.link as string) || "",
      snippet: (obj.snippet as string) || (obj.description as string) || "",
    };
  });
  return { query, results };
}

export const WebSearchAdapter: React.FC<UniversalEventProps> = (props) => {
  const labels = useLifecycleLabels(props.eventType);
  const state = statusToLifecycle(props.status);

  if (state === "failed") return null;

  const { query, results } = extractWebSearchData(props);
  const title =
    labels[state] || getToolDisplayLabelFromRegistry(props.eventType);
  const toolName = props.functionName || props.eventType;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <WebSearchBlock
        query={query}
        results={results}
        isLoading={
          props.status === "running" && props.showActiveEventPainting === true
        }
        defaultCollapsed={true}
        eventId={props.eventId}
        title={title}
        toolUsage={props.toolUsage}
      />
    </div>
  );
};

WebSearchAdapter.displayName = "WebSearchAdapter";

export default WebSearchAdapter;
