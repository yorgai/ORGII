export type GroupByMode = "byTime" | "byAgent" | "byWorkspace" | "byTags";

export const GROUP_BY_MODES: readonly GroupByMode[] = [
  "byTime",
  "byWorkspace",
  "byAgent",
  "byTags",
];

export const NO_WORKSPACE_KEY = "__no_workspace__";

export const LOAD_MORE_PREFIX = "load-more-";
export const LOAD_MORE_GROUP_PREFIX = "load-more-group-";
