/**
 * CHAT_BLOCKS — maps `ChatBlock` to a React Block component.
 *
 * This is the chat-panel analogue of Simulator's app-type routing.
 * `RecipeRenderer` resolves `ChatBlock` from the Rust registry, then
 * uses this map to pick the Block. Adding a new tool that reuses an
 * existing Block requires zero frontend changes — just set `chat_block`
 * in Rust's `builtin_tools.rs`.
 *
 * Every entry is an adapter from `./adapters/` — the adapter pulls
 * pre-translated labels from the Rust registry and hands them to the
 * underlying Block component.
 */
import type { FC } from "react";

import type { ChatBlock } from "@src/engines/SessionCore/rendering/registry/types";
import type { UniversalEventProps } from "@src/engines/SessionCore/rendering/types/universalProps";

import {
  CanvasInlineAdapter,
  DiffAdapter,
  ExploreAdapter,
  FallbackAdapter,
  GlobAdapter,
  OrgTaskAdapter,
  PlanDocAdapter,
  ReadFileAdapter,
  SearchAdapter,
  SentMessageAdapter,
  SetupRepoAdapter,
  ShellAdapter,
  SubagentAdapter,
  TitleOnlyAdapter,
  TodoAdapter,
  WebSearchAdapter,
} from "./adapters";

export type ChatBlockComponent = FC<UniversalEventProps>;

/** Sentinel adapter for `ChatBlock === "hidden"` — tool-call events that
 *  should not appear in the chat stream at all. Kept as an escape hatch
 *  even though no current built-in tool maps to it. */
const HiddenAdapter: ChatBlockComponent = () => null;
HiddenAdapter.displayName = "HiddenAdapter";

export const CHAT_BLOCKS: Record<ChatBlock, ChatBlockComponent> = {
  read_file: ReadFileAdapter,
  diff: DiffAdapter,
  shell: ShellAdapter,
  explore: ExploreAdapter,
  search: SearchAdapter,
  glob: GlobAdapter,
  web_search: WebSearchAdapter,
  todo: TodoAdapter,
  org_task: OrgTaskAdapter,
  subagent: SubagentAdapter,
  title_only: TitleOnlyAdapter,
  sent_message: SentMessageAdapter,
  plan_doc: PlanDocAdapter,
  hidden: HiddenAdapter,
  canvas_inline: CanvasInlineAdapter,
  setup_repo: SetupRepoAdapter,
  fallback: FallbackAdapter,
};

export const FALLBACK_BLOCK: ChatBlockComponent = FallbackAdapter;
