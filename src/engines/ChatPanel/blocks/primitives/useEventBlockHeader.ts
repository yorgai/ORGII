/**
 * useEventBlockHeader - Reusable hook for event block header state
 *
 * Manages collapsed state, header hover state, and optional event locate handler.
 *
 * For event replay, pass `eventId` — the hook pairs with `useBlockLocate`
 * (from the blocks barrel) which wires up simulator navigation without
 * creating a circular dependency through the SessionCore barrel.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useChatSessionId } from "@src/engines/ChatPanel/ChatSessionContext";
import {
  collapseAllEpochMapAtom,
  collapseStateAtom,
  selectCollapseEpoch,
  setCollapseStateAtom,
} from "@src/store/ui/collapseStateAtom";

import { NestedBlockContext } from "./nestedBlockContext";

export interface UseEventBlockHeaderOptions {
  /** Initial collapsed state */
  defaultCollapsed?: boolean;
  /** Callback when collapsed state changes */
  onToggle?: (isCollapsed: boolean) => void;
  /** Optional event ID — stored for handleLocate (requires useBlockLocate to wire up) */
  eventId?: string;
  /**
   * Value to set `isCollapsed` to when the global "collapse all" fires.
   * - `true`  — standard pattern (`!isCollapsed && content`)
   * - `false` — inverted pattern (`isCollapsed` renamed to `isExpanded`)
   * - `undefined` (default) — this block does not participate
   */
  collapseAllValue?: boolean;
}

export interface UseEventBlockHeaderReturn {
  /** Whether the block is collapsed */
  isCollapsed: boolean;
  /** Whether the header is hovered */
  isHeaderHovered: boolean;
  /** Toggle collapsed state */
  toggleCollapsed: () => void;
  /** Set collapsed state directly */
  setIsCollapsed: (collapsed: boolean) => void;
  /** Set header hover state */
  setIsHeaderHovered: (hovered: boolean) => void;
  /** Header mouse enter handler */
  handleHeaderMouseEnter: () => void;
  /** Header mouse leave handler */
  handleHeaderMouseLeave: () => void;
  /** Header click handler (toggles collapse) */
  handleHeaderClick: () => void;
  /** Navigate to eventId in the simulator (undefined if eventId was not provided) */
  handleLocate: (() => void) | undefined;
}

/**
 * Hook for managing event block header state
 */
export function useEventBlockHeader(
  options: UseEventBlockHeaderOptions = {}
): UseEventBlockHeaderReturn {
  const {
    defaultCollapsed = false,
    onToggle,
    eventId,
    collapseAllValue,
  } = options;

  const isNested = useContext(NestedBlockContext);

  const collapseMap = useAtomValue(collapseStateAtom);
  const persistCollapse = useSetAtom(setCollapseStateAtom);

  const participates = collapseAllValue !== undefined;
  const epochMap = useAtomValue(collapseAllEpochMapAtom);
  const sessionId = useChatSessionId();
  const collapseAllEpoch = useMemo(
    () => (participates ? selectCollapseEpoch(epochMap, sessionId) : 0),
    [participates, epochMap, sessionId]
  );

  // Nested (subagent sub-activity) blocks default collapsed but can be
  // expanded by clicking. The persisted collapse map is still checked so
  // a user's explicit expand survives re-renders within the same session.
  const nestedDefault = true;
  const initialCollapsed =
    participates && collapseAllEpoch > 0
      ? collapseAllValue
      : eventId !== undefined
        ? (collapseMap.get(eventId) ??
          (isNested ? nestedDefault : defaultCollapsed))
        : isNested
          ? nestedDefault
          : defaultCollapsed;

  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  // Safety net: reset hover on unmount (onMouseLeave can miss)
  useEffect(() => {
    return () => setIsHeaderHovered(false);
  }, []);

  const [prevEpoch, setPrevEpoch] = useState(collapseAllEpoch);
  if (collapseAllValue !== undefined && collapseAllEpoch !== prevEpoch) {
    setPrevEpoch(collapseAllEpoch);
    setIsCollapsed(collapseAllValue);
  }

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const newValue = !prev;
      onToggle?.(newValue);
      if (eventId) persistCollapse({ eventId, collapsed: newValue });
      return newValue;
    });
  }, [onToggle, eventId, persistCollapse]);

  const handleHeaderMouseEnter = useCallback(() => {
    setIsHeaderHovered(true);
  }, []);

  const handleHeaderMouseLeave = useCallback(() => {
    setIsHeaderHovered(false);
  }, []);

  const handleHeaderClick = useCallback(() => {
    toggleCollapsed();
  }, [toggleCollapsed]);

  return {
    isCollapsed,
    isHeaderHovered,
    toggleCollapsed,
    setIsCollapsed,
    setIsHeaderHovered,
    handleHeaderMouseEnter,
    handleHeaderMouseLeave,
    handleHeaderClick,
    handleLocate: undefined,
  };
}

export default useEventBlockHeader;
