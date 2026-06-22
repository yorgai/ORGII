import type {
  SimulatorEventFilterValue,
  SimulatorEventPreview,
} from "../core/types";

export const SIMULATOR_EVENT_FILTER_VALUES = [
  "key_interactions",
  "file_changes",
  "terminal_events",
  "explore",
  "other",
] as const satisfies readonly SimulatorEventFilterValue[];

export type { SimulatorEventFilterValue };

export function isSimulatorEventVisibleForFilters(
  preview: SimulatorEventPreview,
  selectedFilters: readonly SimulatorEventFilterValue[]
): boolean {
  if (selectedFilters.length === 0) return true;
  return selectedFilters.includes(preview.filterCategory);
}
