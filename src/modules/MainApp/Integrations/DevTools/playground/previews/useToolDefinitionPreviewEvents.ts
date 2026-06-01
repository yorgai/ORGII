import { useMemo } from "react";

import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";
import {
  buildPlaygroundEventsForRegistryToolNames,
  buildPlaygroundEventsForToolCommands,
  createPlaygroundEventForToolName,
} from "@src/modules/MainApp/ToolPreview/mockData";

import { parseSessionEventFromJson } from "../shared";
import type { StatusPreset } from "../single-event/statusPresets";
import type { PlaygroundListSelectionMode } from "../types";

interface UseToolDefinitionPreviewEventsOptions {
  isMultiSelect: boolean;
  selectedTypesMulti: string[];
  selectedType: string;
  selectedStatus: EventDisplayStatus;
  jsonInput: string;
  commandSelectionMode: PlaygroundListSelectionMode;
  selectedSingleCommand: string;
  selectedCommands: string[];
  statusSelectionMode: PlaygroundListSelectionMode;
  selectedPresetKeys: string[];
  statusPresetsForTool: StatusPreset[];
  activePresetKey: string;
}

export function useToolDefinitionPreviewEvents({
  isMultiSelect,
  selectedTypesMulti,
  selectedType,
  selectedStatus,
  jsonInput,
  commandSelectionMode,
  selectedSingleCommand,
  selectedCommands,
  statusSelectionMode,
  selectedPresetKeys,
  statusPresetsForTool,
  activePresetKey,
}: UseToolDefinitionPreviewEventsOptions) {
  const { data: eventData, error: parseError } = useMemo(
    () =>
      isMultiSelect
        ? { data: null, error: null }
        : parseSessionEventFromJson(jsonInput, selectedStatus),
    [jsonInput, selectedStatus, isMultiSelect]
  );

  const multiPreviewEvents = useMemo(() => {
    if (!isMultiSelect) return null;
    return buildPlaygroundEventsForRegistryToolNames(
      selectedTypesMulti,
      selectedStatus
    );
  }, [isMultiSelect, selectedTypesMulti, selectedStatus]);

  const commandPreviewEvents = useMemo(() => {
    if (isMultiSelect) return null;
    const commandsToRender =
      commandSelectionMode === "single"
        ? selectedSingleCommand
          ? [selectedSingleCommand]
          : []
        : selectedCommands;
    if (commandsToRender.length === 0) return null;
    const events = buildPlaygroundEventsForToolCommands(
      selectedType,
      commandsToRender,
      selectedStatus
    );
    if (
      commandSelectionMode === "single" &&
      events.length === 1 &&
      statusSelectionMode === "single"
    ) {
      const preset = statusPresetsForTool.find(
        (item) => item.key === activePresetKey
      );
      if (preset) {
        const event = events[0];
        if (preset.resultPatch) {
          event.result = {
            ...(event.result as Record<string, unknown>),
            ...preset.resultPatch,
          };
        }
        if (preset.argsPatch) {
          event.args = {
            ...(event.args as Record<string, unknown>),
            ...preset.argsPatch,
          };
        }
        event.displayStatus = preset.status;
      }
    }
    return events;
  }, [
    isMultiSelect,
    commandSelectionMode,
    selectedSingleCommand,
    selectedCommands,
    selectedType,
    selectedStatus,
    statusSelectionMode,
    statusPresetsForTool,
    activePresetKey,
  ]);

  const multiStatusPreviewEvents = useMemo<SessionEvent[] | null>(() => {
    if (isMultiSelect) return null;
    if (statusSelectionMode !== "multiple") return null;
    if (commandSelectionMode !== "single") return null;
    if (!selectedType || selectedPresetKeys.length === 0) return null;
    const out: SessionEvent[] = [];
    for (const key of selectedPresetKeys) {
      const preset = statusPresetsForTool.find((item) => item.key === key);
      if (!preset) continue;
      const base = createPlaygroundEventForToolName(
        selectedType,
        preset.status
      );
      if (preset.resultPatch) {
        base.result = {
          ...(base.result as Record<string, unknown>),
          ...preset.resultPatch,
        };
      }
      if (preset.argsPatch) {
        base.args = {
          ...(base.args as Record<string, unknown>),
          ...preset.argsPatch,
        };
      }
      out.push(base);
    }
    return out;
  }, [
    isMultiSelect,
    statusSelectionMode,
    commandSelectionMode,
    selectedPresetKeys,
    selectedType,
    statusPresetsForTool,
  ]);

  return {
    eventData,
    parseError,
    multiPreviewEvents,
    commandPreviewEvents,
    multiStatusPreviewEvents,
  };
}
