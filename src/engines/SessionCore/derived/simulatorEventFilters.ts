import type {
  SessionEvent,
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

export function getFallbackSimulatorEventFilterCategory(
  event: SessionEvent
): SimulatorEventFilterValue {
  if (event.source === "user") return "key_interactions";
  if (
    event.uiCanonical === "edit_file" ||
    event.uiCanonical === "delete_file"
  ) {
    return "file_changes";
  }
  if (event.command || event.uiCanonical === "run_shell") {
    return "terminal_events";
  }
  if (
    event.uiCanonical === "read_file" ||
    event.uiCanonical === "list_dir" ||
    event.uiCanonical === "code_search" ||
    event.uiCanonical === "glob" ||
    event.uiCanonical === "find_files" ||
    event.uiCanonical === "search"
  ) {
    return "explore";
  }
  if (event.filePath) return "file_changes";
  return "other";
}

export function isSimulatorEventVisibleForFilters(
  preview: SimulatorEventPreview,
  selectedFilters: readonly SimulatorEventFilterValue[]
): boolean {
  if (selectedFilters.length === 0) return true;
  return selectedFilters.includes(preview.filterCategory);
}
