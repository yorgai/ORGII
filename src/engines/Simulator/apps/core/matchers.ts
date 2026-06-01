/**
 * Event Category Matchers
 *
 * Utility functions for matching event names to app categories.
 * Uses Rust registry (getAppTypeForTool) as single source of truth.
 */
import { getAppTypeForTool } from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

import type { AppType } from "../../types/appTypes";

/**
 * Match event by AppType from Rust registry.
 * This is the preferred method — uses Rust as single source of truth.
 */
export function matchesByAppType(
  eventFunction: string,
  appType: AppType
): boolean {
  return getAppTypeForTool(eventFunction) === appType;
}
