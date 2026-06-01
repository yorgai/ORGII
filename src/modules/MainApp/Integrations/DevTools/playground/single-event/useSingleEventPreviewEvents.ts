import { useMemo } from "react";

import type {
  EventDisplayStatus,
  SessionEvent,
} from "@src/engines/SessionCore/core/types";
import {
  MOCK_EVENT_DATA,
  buildPlaygroundEventsForToolCommands,
  buildPlaygroundEventsForTypes,
} from "@src/modules/MainApp/ToolPreview/mockData";

import { parseSessionEventFromJson } from "../shared";
import type { PlaygroundListSelectionMode } from "../types";
import { isChatPreviewType } from "./chatPreviewTypes";
import { SPECIAL_STATUS_PRESETS, type StatusPreset } from "./statusPresets";
import { useStreamingSimulation } from "./useStreamingSimulation";

interface UseSingleEventPreviewEventsOptions {
  isMultiSelect: boolean;
  selectedTypesMulti: string[];
  selectedType: string;
  selectedStatus: EventDisplayStatus;
  activePresetKey: string;
  jsonInput: string;
  commandSelectionMode: PlaygroundListSelectionMode;
  selectedSingleCommand: string;
  selectedCommands: string[];
  statusSelectionMode: PlaygroundListSelectionMode;
  selectedPresetKeys: string[];
  statusPresetsForUi: StatusPreset[];
}

export function useSingleEventPreviewEvents({
  isMultiSelect,
  selectedTypesMulti,
  selectedType,
  selectedStatus,
  activePresetKey,
  jsonInput,
  commandSelectionMode,
  selectedSingleCommand,
  selectedCommands,
  statusSelectionMode,
  selectedPresetKeys,
  statusPresetsForUi,
}: UseSingleEventPreviewEventsOptions) {
  const activeStreamingContent = useMemo(() => {
    const presets = SPECIAL_STATUS_PRESETS[selectedType];
    if (!presets) return undefined;
    const preset = presets.find((item) => item.key === activePresetKey);
    if (!preset?.argsPatch?.streamContent) return undefined;
    return preset.argsPatch.streamContent as string;
  }, [selectedType, activePresetKey]);

  const isSimulatingStream = Boolean(activeStreamingContent);
  const simulatedContent = useStreamingSimulation(
    activeStreamingContent,
    isSimulatingStream
  );

  const streamingEventOverride = useMemo<SessionEvent | null>(() => {
    if (!isSimulatingStream || simulatedContent === undefined) return null;
    try {
      const baseMock = MOCK_EVENT_DATA[selectedType];
      if (!baseMock) return null;
      const base = JSON.parse(JSON.stringify(baseMock)) as SessionEvent;
      const presets = SPECIAL_STATUS_PRESETS[selectedType];
      const preset = presets?.find((item) => item.key === activePresetKey);
      if (preset?.resultPatch) {
        base.result = {
          ...(base.result as Record<string, unknown>),
          ...preset.resultPatch,
        };
      }
      base.args = {
        ...(base.args as Record<string, unknown>),
        ...(preset?.argsPatch ?? {}),
        streamContent: simulatedContent,
      };
      base.displayStatus = selectedStatus;
      return base;
    } catch {
      return null;
    }
  }, [
    simulatedContent,
    isSimulatingStream,
    selectedType,
    activePresetKey,
    selectedStatus,
  ]);

  const { data: eventData, error: parseError } = useMemo(
    () =>
      isMultiSelect
        ? { data: null, error: null }
        : parseSessionEventFromJson(jsonInput, selectedStatus),
    [jsonInput, selectedStatus, isMultiSelect]
  );

  const effectiveEventData = streamingEventOverride ?? eventData;

  const multiPreviewEvents = useMemo(() => {
    if (!isMultiSelect) return null;
    return buildPlaygroundEventsForTypes(
      selectedTypesMulti.filter((eventType) => !isChatPreviewType(eventType)),
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
      const preset = statusPresetsForUi.find(
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
    statusPresetsForUi,
    activePresetKey,
  ]);

  const multiStatusPreviewEvents = useMemo<SessionEvent[] | null>(() => {
    if (isMultiSelect) return null;
    if (statusSelectionMode !== "multiple") return null;
    if (commandSelectionMode !== "single") return null;
    if (selectedPresetKeys.length === 0) return null;

    const baseMock = MOCK_EVENT_DATA[selectedType];
    if (!baseMock) return null;

    const out: SessionEvent[] = [];
    for (const key of selectedPresetKeys) {
      const preset = statusPresetsForUi.find((item) => item.key === key);
      if (!preset) continue;
      const base = JSON.parse(JSON.stringify(baseMock)) as SessionEvent;
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
      base.displayStatus = preset.status as EventDisplayStatus;
      out.push(base);
    }
    return out;
  }, [
    isMultiSelect,
    statusSelectionMode,
    commandSelectionMode,
    selectedPresetKeys,
    selectedType,
    statusPresetsForUi,
  ]);

  return {
    effectiveEventData,
    parseError,
    multiPreviewEvents,
    commandPreviewEvents,
    multiStatusPreviewEvents,
  };
}
