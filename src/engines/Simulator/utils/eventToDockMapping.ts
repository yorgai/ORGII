/**
 * Event to Dock App Mapping
 *
 * Lightweight lookup used by SessionCore-derived atoms.
 *
 * Keep this file free of WorkStation / simulator registry imports:
 * `simulatorEvents.ts` is initialized during SessionCore startup, and pulling
 * WorkStation registry/config modules here creates a circular init chain.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { AppType } from "../types/appTypes";
import {
  getSimulatorAppTypeForEventName,
  getSimulatorAppTypeForEventNameSafe,
} from "./simulatorEventRouting";

/**
 * Map event function type to corresponding Dock app type.
 * Uses exact-match table first, falls back to the Simulator Registry's
 * pattern matcher so new app registrations are picked up automatically.
 *
 * Returns null when the event does not map to any simulator dock app.
 */
export const getAppTypeForEvent = getSimulatorAppTypeForEventName;

/**
 * Map event to app type with null safety
 *
 * @param eventFunction - The event function name (can be null/undefined)
 * @returns The corresponding AppType for the dock, or null when unmapped
 */
export const getAppTypeForEventSafe = getSimulatorAppTypeForEventNameSafe;

export function isGenericToolCallEvent(
  event: SessionEvent | null | undefined
): boolean {
  return event?.displayVariant === "tool_call" && event.source !== "user";
}

export function isGenericCodeEditorToolEvent(
  event: SessionEvent | null | undefined
): boolean {
  return (
    !!event &&
    getAppTypeForEventSafe(event.functionName) === null &&
    isGenericToolCallEvent(event)
  );
}

export function getAppTypeForSessionEvent(
  event: SessionEvent | null | undefined
): AppType | null {
  if (!event) return null;
  const mapped = getAppTypeForEventSafe(event.functionName);
  if (mapped !== null) return mapped;
  if (isGenericCodeEditorToolEvent(event)) return AppType.CODE_EDITOR;
  if (event.source === "user") return AppType.CHANNELS;
  return null;
}
