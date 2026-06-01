/**
 * useCherryPickSelection - Hook for cherry-pick line selection state and callbacks.
 * Extracted from VirtualizedModernDiff for separation of concerns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChangeRange, DiffLine } from "./types";

export interface UseCherryPickSelectionOptions {
  diffLines: DiffLine[];
  cherrypicking: boolean;
  initialSelection?: Set<number>;
  onSelectionChange?: (selectedLines: Set<number>) => void;
}

export interface UseCherryPickSelectionResult {
  selectedLines: Set<number>;
  toggleLineSelection: (index: number) => void;
  toggleRangeSelection: (range: ChangeRange) => void;
  isRangeSelected: (range: ChangeRange) => boolean;
  toggleAllSelection: () => void;
  allSelected: boolean;
  changeRanges: ChangeRange[];
  lineToRange: Map<number, ChangeRange>;
}

export function useCherryPickSelection(
  options: UseCherryPickSelectionOptions
): UseCherryPickSelectionResult {
  const { diffLines, cherrypicking, initialSelection, onSelectionChange } =
    options;

  const [selectedLines, setSelectedLines] = useState<Set<number>>(
    () => initialSelection || new Set()
  );
  const hasInitializedSelection = useRef(false);
  const previousChangeableIndices = useRef<Set<number>>(new Set());

  // Get changeable line indices (add/remove lines, including inside collapsed sections)
  const changeableLineIndices = useMemo(() => {
    const indices: number[] = [];
    const collectIndices = (lines: DiffLine[]) => {
      lines.forEach((line) => {
        if (line.type === "add" || line.type === "remove") {
          if (line.index !== undefined) {
            indices.push(line.index);
          }
        }
        if (line.collapsedLines) {
          collectIndices(line.collapsedLines);
        }
      });
    };
    collectIndices(diffLines);
    return indices;
  }, [diffLines]);

  // Check if all changeable lines are selected
  const allSelected = useMemo(() => {
    if (changeableLineIndices.length === 0) return false;
    return changeableLineIndices.every((idx) => selectedLines.has(idx));
  }, [changeableLineIndices, selectedLines]);

  // Compute contiguous change ranges
  const changeRanges = useMemo(() => {
    const ranges: ChangeRange[] = [];
    let currentRange: ChangeRange | null = null;

    diffLines.forEach((line) => {
      if (line.type === "collapse") {
        if (currentRange) {
          ranges.push(currentRange);
          currentRange = null;
        }
        return;
      }

      const isChange = line.type === "add" || line.type === "remove";

      if (isChange && line.index !== undefined) {
        if (!currentRange) {
          currentRange = { startIndex: line.index, lineIndices: [line.index] };
        } else {
          currentRange.lineIndices.push(line.index);
        }
      } else {
        if (currentRange) {
          ranges.push(currentRange);
          currentRange = null;
        }
      }
    });

    if (currentRange) {
      ranges.push(currentRange);
    }

    return ranges;
  }, [diffLines]);

  // Map each line index to its containing range
  const lineToRange = useMemo(() => {
    const map = new Map<number, ChangeRange>();
    changeRanges.forEach((range) => {
      range.lineIndices.forEach((idx) => {
        map.set(idx, range);
      });
    });
    return map;
  }, [changeRanges]);

  // Auto-select new changes when they appear
  useEffect(() => {
    if (!cherrypicking || changeableLineIndices.length === 0) return;

    // When initialSelection is provided, first run just records current indices
    if (initialSelection && !hasInitializedSelection.current) {
      hasInitializedSelection.current = true;
      previousChangeableIndices.current = new Set(changeableLineIndices);
      return;
    }

    // Unified initialization + incremental update:
    // On first run without initialSelection, previousChangeableIndices is empty,
    // so all changeable indices are treated as "new" and get auto-selected.
    // On subsequent runs, only newly added indices are selected.
    const newIndices = changeableLineIndices.filter(
      (idx) => !previousChangeableIndices.current.has(idx)
    );

    if (newIndices.length > 0) {
      hasInitializedSelection.current = true;
      setSelectedLines((prev) => {
        const next = new Set(prev);
        newIndices.forEach((idx) => next.add(idx));
        onSelectionChange?.(next);
        return next;
      });
    }

    previousChangeableIndices.current = new Set(changeableLineIndices);
  }, [
    cherrypicking,
    changeableLineIndices,
    initialSelection,
    onSelectionChange,
  ]);

  // Toggle a single line's selection
  const toggleLineSelection = useCallback(
    (index: number) => {
      setSelectedLines((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange]
  );

  // Toggle all lines in a range
  const toggleRangeSelection = useCallback(
    (range: ChangeRange) => {
      setSelectedLines((prev) => {
        const next = new Set(prev);
        const allInRangeSelected = range.lineIndices.every((idx) =>
          prev.has(idx)
        );

        if (allInRangeSelected) {
          range.lineIndices.forEach((idx) => next.delete(idx));
        } else {
          range.lineIndices.forEach((idx) => next.add(idx));
        }
        onSelectionChange?.(next);
        return next;
      });
    },
    [onSelectionChange]
  );

  // Check if all lines in a range are selected
  const isRangeSelected = useCallback(
    (range: ChangeRange) => {
      return range.lineIndices.every((idx) => selectedLines.has(idx));
    },
    [selectedLines]
  );

  // Toggle selection of all changeable lines
  const toggleAllSelection = useCallback(() => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        changeableLineIndices.forEach((idx) => next.delete(idx));
      } else {
        changeableLineIndices.forEach((idx) => next.add(idx));
      }
      onSelectionChange?.(next);
      return next;
    });
  }, [allSelected, changeableLineIndices, onSelectionChange]);

  return {
    selectedLines,
    toggleLineSelection,
    toggleRangeSelection,
    isRangeSelected,
    toggleAllSelection,
    allSelected,
    changeRanges,
    lineToRange,
  };
}
