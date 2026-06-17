/**
 * Context Collectors
 *
 * ADE context payloads for agents (see AdeContextCollector).
 */

export {
  collectAdeContext,
  collectAdeContextAsync,
} from "./AdeContextCollector";
export type { WorkspaceSnapshot } from "@src/services/context/workspaceSnapshot";
