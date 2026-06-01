/**
 * NestedBlockContext
 *
 * Signals that the current block subtree is being rendered inside
 * another event (e.g. a subagent's sub-activity list rendered inside
 * `SubagentBlock`). When set, `useEventBlockHeader` defaults child
 * blocks to collapsed but still allows expand/collapse toggling.
 *
 * Default `false` (regular top-level blocks use their own default).
 */
import { createContext } from "react";

export const NestedBlockContext = createContext<boolean>(false);
