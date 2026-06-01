import type { ModelVariantInfo } from "@src/api/types/keys";

export type ModelTableViewMode = "flat" | "group";

/** 32px — Input/Select inside table rows only (not search bar). */
export const MODEL_TABLE_CONTROL_SIZE = "default" as const;

/** Switch size for ModelTable and Integrations Models / My Keys tables. */
export const MODEL_TABLE_SWITCH_SIZE = "default" as const;

/** Alias row compatible with Key Vault wizard `ModelAlias` (structural). */
export interface ModelTableModelAlias {
  displayName: string;
  alias: string;
  icon?: string;
  rowId?: string;
}

export interface ModelTableVariantInfo extends ModelVariantInfo {
  model: string;
  base_model: string;
  reasoning?: string | null;
  fast: boolean;
}
