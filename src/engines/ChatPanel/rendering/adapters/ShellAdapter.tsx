/**
 * ShellAdapter — handles `run_shell`. Resolves the `run` / `kill`
 * lifecycle labels from the Rust registry and hands the pre-translated
 * strings to `ShellBlock`.
 *
 * `await_output` is a separate chat_block (`TitleOnly`) and never reaches
 * this adapter; it's rendered by `TitleOnlyAdapter` directly.
 */
import React from "react";

import {
  statusToLifecycle,
  useLifecycleLabels,
} from "@src/engines/SessionCore/rendering/registry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";

import { ShellBlock } from "../../blocks/ShellBlock";

export const ShellAdapter: React.FC<UniversalEventProps> = (props) => {
  const action = (props.args?.action as string) || undefined;
  const runLabels = useLifecycleLabels("run_shell", action ?? "run");
  const killLabels = useLifecycleLabels("run_shell", "kill");
  const state = statusToLifecycle(props.status);

  const toolName = props.eventType || props.functionName;

  return (
    <div data-tool-call-event-id={props.eventId} data-tool-call-name={toolName}>
      <ShellBlock
        {...props}
        title={runLabels[state]}
        killTitle={killLabels[state]}
        failedLabel={runLabels.failed}
      />
    </div>
  );
};

ShellAdapter.displayName = "ShellAdapter";

export default ShellAdapter;
