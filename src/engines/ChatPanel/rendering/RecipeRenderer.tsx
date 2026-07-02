/**
 * RecipeRenderer — Data-driven event renderer
 *
 * Dispatches rendering based on the per-action ChatBlock from the Rust
 * tool registry. Each ChatBlock maps to exactly one Block component via
 * the CHAT_BLOCKS map.
 *
 * Flow:
 * 1. Resolve uiCanonical + action name from raw props
 * 2. Look up getActionChatBlock(tool, action) → ChatBlock
 * 3. Pick the Block from CHAT_BLOCKS[chatBlock]
 * 4. Render the Block with normalizedProps (UniversalEventProps)
 *
 * See `.cursor/rules/event-rendering.mdc` for the full dispatch model.
 */
import React from "react";

import {
  type RawEventInput,
  useNormalizedEventProps,
} from "@src/engines/SessionCore/rendering/props/propsNormalizer";
import {
  getActionChatBlock,
  getCliUiCanonical,
} from "@src/engines/SessionCore/rendering/registry/initToolRegistry";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";
import { deriveToolAction } from "@src/util/ui/rendering/toolAction";

import { CHAT_BLOCKS, FALLBACK_BLOCK } from "./chatBlocks";

export type RecipeRendererProps = RawEventInput;

function extractActualToolName(props: RawEventInput): string {
  const fnName = (props as Record<string, unknown>).functionName as
    | string
    | undefined;
  if (fnName && fnName !== "tool_call" && fnName !== "unknown") return fnName;

  const eventFn = props.event?.functionName;
  if (eventFn && eventFn !== "tool_call" && eventFn !== "unknown")
    return eventFn;

  const directFn = (props as Record<string, unknown>).function as
    | string
    | undefined;
  if (directFn && directFn !== "tool_call" && directFn !== "unknown")
    return directFn;

  return "tool_call";
}

const ACTION_MARKER_RE = /^\s*\[action:\s*([a-z_]+)\]\s*$/m;

function extractAction(normalizedProps: UniversalEventProps): string {
  const derived = deriveToolAction(
    normalizedProps.functionName ?? normalizedProps.eventType,
    normalizedProps.args
  );
  if (derived) return derived;

  const output = normalizedProps.result?.output;
  if (typeof output === "string") {
    const match = output.match(ACTION_MARKER_RE);
    if (match) return match[1];
  }
  const content = normalizedProps.result?.content;
  if (typeof content === "string") {
    const match = content.match(ACTION_MARKER_RE);
    if (match) return match[1];
  }

  return "";
}

export const RecipeRenderer: React.FC<RecipeRendererProps> = (props) => {
  const toolName = extractActualToolName(props);
  const eventUiCanonical = props.event?.uiCanonical;
  const directUiCanonical = (props as Record<string, unknown>).uiCanonical as
    | string
    | undefined;
  const uiCanonical =
    eventUiCanonical && eventUiCanonical !== "tool_call"
      ? eventUiCanonical
      : directUiCanonical && directUiCanonical !== "tool_call"
        ? directUiCanonical
        : getCliUiCanonical(toolName);
  const normalizedProps = useNormalizedEventProps(props, uiCanonical);

  if (!normalizedProps) return null;

  const action = extractAction(normalizedProps);
  const chatBlock =
    getActionChatBlock(uiCanonical, action || undefined) ??
    getActionChatBlock(toolName, action || undefined) ??
    getActionChatBlock(normalizedProps.functionName ?? "", action || undefined);
  const Block = chatBlock ? CHAT_BLOCKS[chatBlock] : FALLBACK_BLOCK;

  return <Block {...normalizedProps} />;
};

RecipeRenderer.displayName = "RecipeRenderer";

export default RecipeRenderer;
