import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import { agentMessageEvents } from "./agentMessages";
import { codingToolsEvents } from "./codingTools";
import { fileOpsEvents } from "./fileOps";
import { taskToolsEvents } from "./taskTools";
import { webBrowserEvents } from "./webBrowser";

/**
 * Mock SessionEvent data for each event type.
 * Organized by the ui_canonical names from the unified event registry.
 */
export const MOCK_EVENT_DATA: Record<string, SessionEvent> = {
  ...fileOpsEvents,
  ...codingToolsEvents,
  ...webBrowserEvents,
  ...agentMessageEvents,
  ...taskToolsEvents,
};
