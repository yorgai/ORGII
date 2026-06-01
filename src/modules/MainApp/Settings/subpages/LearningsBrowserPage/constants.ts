import type {
  LearningCategoryValue,
  LearningSourceValue,
  LearningStatusValue,
} from "@src/api/tauri/rpc/schemas/learning";

export type StatusFilterKey = "all" | LearningStatusValue;
export type SourceFilterKey = "all" | LearningSourceValue;
export type CategoryFilterKey = "all" | LearningCategoryValue;

export const STATUS_FILTER_ALL = "all" as const;
export const LEARNINGS_PAGE_SIZE = 25;

export const STATUS_SELECT_ORDER: StatusFilterKey[] = [
  "all",
  "pending",
  "active",
  "deprecated",
];

export const STATUS_SELECT_ORDER_FULL: StatusFilterKey[] = [
  "all",
  "pending",
  "active",
  "merged",
  "deprecated",
  "abandoned",
];

export const SOURCE_SELECT_ORDER: SourceFilterKey[] = [
  "all",
  "reflection",
  "pattern_extraction",
  "active_observation",
];

export const CATEGORY_SELECT_ORDER: CategoryFilterKey[] = [
  "all",
  "pattern",
  "correction",
  "preference",
  "strategy",
];

export const PANEL_COLUMN_KEYS = [
  "takeaway",
  "agent",
  "category",
  "status",
  "updated",
  "actions",
] as const;

export const READ_ONLY_LEARNING_STATUSES: readonly LearningStatusValue[] = [
  "merged",
  "abandoned",
];
