/**
 * Pure simulator event routing helpers.
 *
 * This module is intentionally limited to SessionCore registry metadata and
 * Simulator app identifiers. It must not import WorkStation app registry,
 * WorkStation UI configs, or ChatPanel renderers.
 */
import { PLAN_EVENT_NAME } from "@src/engines/SessionCore/derived/planDisplayEvents";
import { getAppTypeForEvent as getExactMatch } from "@src/engines/SessionCore/rendering/registry/constants";
import { getActionChatBlock } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

import { AppType } from "../types/appTypes";

export function isDiffRoutedEvent(
  toolName: string | null | undefined,
  action?: string
): boolean {
  if (!toolName) return false;
  return getActionChatBlock(toolName, action) === "diff";
}

export function getSimulatorAppTypeForEventName(
  eventFunction: string
): AppType | null {
  if (
    eventFunction === PLAN_EVENT_NAME.CREATE_PLAN ||
    eventFunction === PLAN_EVENT_NAME.PLAN_APPROVAL
  ) {
    return AppType.CHANNELS;
  }

  const exact = getExactMatch(eventFunction);
  if (exact !== null) return exact as AppType;

  if (isDiffRoutedEvent(eventFunction)) {
    return AppType.DIFF;
  }

  return null;
}

export function getSimulatorAppTypeForEventNameSafe(
  eventFunction: string | null | undefined
): AppType | null {
  if (!eventFunction) return null;
  return getSimulatorAppTypeForEventName(eventFunction);
}
