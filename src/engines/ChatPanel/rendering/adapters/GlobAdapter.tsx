/**
 * GlobAdapter — renders `find_files` / `glob_file_search` hits via the
 * header-only `GlobBlock`. Only the pattern and lifecycle label are
 * forwarded; matched files are visible in the simulator.
 */
import React from "react";

import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import GlobBlock from "../../blocks/GlobBlock";

function extractPattern(props: UniversalEventProps): string {
  const { args } = props;
  if (props.rustExtracted?.kind === "glob" && props.rustExtracted.pattern) {
    return props.rustExtracted.pattern;
  }
  return (
    (args?.pattern as string) ||
    (args?.glob_pattern as string) ||
    (args?.globPattern as string) ||
    (args?.glob as string) ||
    (args?.query as string) ||
    ""
  );
}

function extractTotalFiles(props: UniversalEventProps): number | null {
  if (props.rustExtracted?.kind === "glob") {
    return props.rustExtracted.totalFiles;
  }
  return null;
}

export const GlobAdapter: React.FC<UniversalEventProps> = (props) => {
  const action =
    (props.args?.action as string | undefined) ??
    (props.eventType === "glob_file_search" ? undefined : "find_files");
  const labels = useLifecycleLabels(props.eventType, action);
  const state = statusToLifecycle(props.status);

  if (state === "failed") return null;

  const pattern = extractPattern(props);
  const totalFiles = extractTotalFiles(props);
  const isLoading =
    props.status === "running" && props.showActiveEventPainting === true;
  const showNoMatch = state === "done" && !isLoading && totalFiles === 0;
  const title = showNoMatch
    ? getToolDisplayLabelFromRegistry(props.eventType, action)
    : labels[state] || getToolDisplayLabelFromRegistry(props.eventType, action);
  const toolName = props.functionName || props.eventType;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <GlobBlock
        pattern={pattern}
        isLoading={isLoading}
        eventId={props.eventId}
        title={title}
        showNoMatch={showNoMatch}
      />
    </div>
  );
};

GlobAdapter.displayName = "GlobAdapter";

export default GlobAdapter;
