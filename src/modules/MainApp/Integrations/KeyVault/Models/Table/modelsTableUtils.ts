import type {
  AvailableModelRow,
  ConsolidatedModelRow,
  ModelSourceEntry,
} from "../../../Tables/types";

export const ALL_FILTER = "all";
export const OTHER_FILTER = "Other";
export const MIN_FAMILY_SIZE = 3;

export const STATUS_FILTER = {
  ALL: "all",
  ENABLED: "enabled",
  DISABLED: "disabled",
} as const;

export type StatusFilter = (typeof STATUS_FILTER)[keyof typeof STATUS_FILTER];

export const MODEL_SCOPE = {
  CURRENT: "current_models",
  INCLUDE_OLDER: "include_older",
} as const;

export const TOKEN_MARKET_SOURCE = "Token Market";
export const MAX_SOURCE_ICONS = 5;

export function getConsolidatedRowKey(row: ConsolidatedModelRow): string {
  return row.model;
}

export function getModelRowKey(row: AvailableModelRow): string {
  return `${row.model}|${row.modelType}`;
}

export function dedupeSourceTypes(sources: ModelSourceEntry[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const src of sources) {
    if (!seen.has(src.modelType)) {
      seen.add(src.modelType);
      result.push(src.modelType);
    }
  }
  return result;
}
