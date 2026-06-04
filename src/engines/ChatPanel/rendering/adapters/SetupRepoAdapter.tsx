import React from "react";

import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";

import SetupRepoBlock, {
  type SetupRepoAppType,
  type SetupRepoEnvVar,
  type SetupRepoStatus,
} from "../../blocks/SetupRepoBlock";

function extractEnvVars(
  args: Record<string, unknown>
): SetupRepoEnvVar[] | undefined {
  const raw = args.env_vars;
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        item !== null && typeof item === "object"
    )
    .map((item) => ({
      key: typeof item.key === "string" ? item.key : String(item.key ?? ""),
      value: typeof item.value === "string" ? item.value : undefined,
      description:
        typeof item.description === "string" ? item.description : undefined,
    }));
}

export const SetupRepoAdapter: React.FC<UniversalEventProps> = (props) => {
  const args = props.args ?? {};
  const action = (args.action as string) || undefined;
  const labels = useLifecycleLabels(props.eventType, action);
  const state = statusToLifecycle(props.status);

  const status = args.status as SetupRepoStatus | undefined;
  const message = typeof args.message === "string" ? args.message : undefined;
  const envVars = extractEnvVars(args);
  const url = typeof args.url === "string" ? args.url : undefined;
  const command = typeof args.command === "string" ? args.command : undefined;
  const appType = args.app_type as SetupRepoAppType | undefined;

  const toolName = props.functionName || props.eventType;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <SetupRepoBlock
        action={action ?? ""}
        status={status}
        message={message}
        envVars={envVars}
        url={url}
        command={command}
        appType={appType}
        lifecycleLabel={labels[state]}
        isRunning={
          props.status === "running" && props.showActiveEventPainting === true
        }
        isFailed={props.status === "failed"}
      />
    </div>
  );
};

SetupRepoAdapter.displayName = "SetupRepoAdapter";

export default SetupRepoAdapter;
