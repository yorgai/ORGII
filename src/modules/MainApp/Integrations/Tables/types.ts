import type { ModelType } from "@src/api/tauri/rpc/schemas/validation";

export interface AvailableModelRow {
  model: string;
  source: string;
  modelType: ModelType;
  keys: number;
  enabled: boolean;
  isOlder: boolean;
}

export interface ModelSourceEntry {
  source: string;
  modelType: ModelType;
  keys: number;
  enabledKeys: number;
  enabled: boolean;
}

export interface ConsolidatedModelRow {
  model: string;
  sources: ModelSourceEntry[];
  totalKeys: number;
  allEnabled: boolean;
  someEnabled: boolean;
  isOlder: boolean;
}
