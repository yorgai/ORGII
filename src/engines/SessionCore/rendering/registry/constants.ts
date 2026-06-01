/**
 * Simulator routing helpers.
 *
 * The unified tool registry (`initToolRegistry`) is the single source of
 * truth. This module exposes a thin simulator-facing alias so Simulator
 * call sites read as `getAppTypeForEvent(eventName)` rather than the more
 * generic `getAppTypeForTool`.
 */
import { getAppTypeForTool } from "./initToolRegistry";

/**
 * Get the AppType for a given event function name.
 *
 * Lookup order inside `getAppTypeForTool`:
 *   1. Builtin map (canonical names like `read_file`, `run_shell`)
 *   2. CLI alias map (raw CLI agent names like `bash`, `Shell`)
 *
 * @returns AppType string (`CODE_EDITOR`, `BROWSER`, `CHANNELS`,
 *   `DB_MANAGER`, `STORY_MANAGER`) or `null` when the event is
 *   unmapped.
 */
export function getAppTypeForEvent(functionName?: string): string | null {
  return getAppTypeForTool(functionName);
}
