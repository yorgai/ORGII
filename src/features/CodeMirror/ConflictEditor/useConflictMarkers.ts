/**
 * useConflictMarkers Hook
 *
 * Parses conflict markers from file content and provides
 * utilities for conflict resolution.
 */
import { useCallback, useMemo } from "react";

import type {
  ConflictBlock,
  ConflictResolutionChoice,
  UseConflictMarkersResult,
} from "./types";

// Conflict marker patterns (with multiline flag for proper detection)
const MARKER_PATTERNS = {
  /** Start of current (HEAD) section: <<<<<<< label */
  currentStart: /^<{7}\s*(.*)$/m,
  /** Separator between current and incoming: ======= */
  separator: /^={7}$/m,
  /** End of incoming section: >>>>>>> label */
  incomingEnd: /^>{7}\s*(.*)$/m,
};

/**
 * Generate unique ID for a conflict block
 */
function generateConflictId(lineNumber: number): string {
  return `conflict-${lineNumber}`;
}

/**
 * Parse conflict blocks from content
 */
function parseConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split("\n");
  const conflicts: ConflictBlock[] = [];

  let inConflict = false;
  let inCurrentSection = false;
  let currentLines: string[] = [];
  let incomingLines: string[] = [];
  let currentLabel = "";
  let markerStartLine = 0;
  let separatorLine = 0;
  const _currentStartLine = 0;
  const _currentEndLine = 0;
  const _incomingStartLine = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Check for conflict start marker
    const currentMatch = line.match(MARKER_PATTERNS.currentStart);
    if (currentMatch) {
      inConflict = true;
      inCurrentSection = true;
      currentLabel = currentMatch[1] || "HEAD";
      markerStartLine = lineIdx;
      currentLines = [];
      incomingLines = [];
      continue;
    }

    // Check for separator
    if (inConflict && MARKER_PATTERNS.separator.test(line)) {
      inCurrentSection = false;
      separatorLine = lineIdx;
      continue;
    }

    // Check for conflict end marker
    const incomingMatch = line.match(MARKER_PATTERNS.incomingEnd);
    if (inConflict && incomingMatch) {
      const incomingLabel = incomingMatch[1] || "incoming";

      conflicts.push({
        id: generateConflictId(markerStartLine),
        startLine: markerStartLine,
        endLine: lineIdx,
        markerStartLine,
        separatorLine,
        markerEndLine: lineIdx,
        currentContent: currentLines.join("\n"),
        incomingContent: incomingLines.join("\n"),
        currentLabel,
        incomingLabel,
        resolved: false,
      });

      inConflict = false;
      inCurrentSection = false;
      continue;
    }

    // Collect content lines
    if (inConflict) {
      if (inCurrentSection) {
        currentLines.push(line);
      } else {
        incomingLines.push(line);
      }
    }
  }

  return conflicts;
}

/**
 * Apply a resolution choice to a conflict and return the new content
 */
function applyResolution(
  content: string,
  conflict: ConflictBlock,
  choice: ConflictResolutionChoice
): string {
  const lines = content.split("\n");
  const result: string[] = [];

  let skipUntilEnd = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    // Start skipping at conflict start
    if (lineIdx === conflict.startLine) {
      skipUntilEnd = true;

      // Insert resolved content based on choice
      if (choice === "current") {
        if (conflict.currentContent) {
          result.push(...conflict.currentContent.split("\n"));
        }
      } else if (choice === "incoming") {
        if (conflict.incomingContent) {
          result.push(...conflict.incomingContent.split("\n"));
        }
      } else if (choice === "both") {
        if (conflict.currentContent) {
          result.push(...conflict.currentContent.split("\n"));
        }
        if (conflict.incomingContent) {
          result.push(...conflict.incomingContent.split("\n"));
        }
      }
      continue;
    }

    // Skip conflict content
    if (skipUntilEnd) {
      if (lineIdx === conflict.endLine) {
        skipUntilEnd = false;
      }
      continue;
    }

    result.push(lines[lineIdx]);
  }

  return result.join("\n");
}

/**
 * Check if content has conflict markers
 */
function hasConflictMarkers(content: string): boolean {
  return (
    MARKER_PATTERNS.currentStart.test(content) &&
    MARKER_PATTERNS.separator.test(content) &&
    MARKER_PATTERNS.incomingEnd.test(content)
  );
}

/**
 * Hook for parsing and managing conflict markers in file content
 */
export function useConflictMarkers(content: string): UseConflictMarkersResult {
  // Parse conflicts from content
  const conflicts = useMemo(() => parseConflictBlocks(content), [content]);

  // Derived values
  const hasConflicts = useMemo(
    () => conflicts.length > 0 && hasConflictMarkers(content),
    [conflicts, content]
  );

  const conflictCount = conflicts.length;
  const resolvedCount = conflicts.filter(
    (conflict) => conflict.resolved
  ).length;

  // Apply resolution to a specific conflict
  const resolveConflict = useCallback(
    (conflictId: string, choice: ConflictResolutionChoice): string => {
      const conflict = conflicts.find(
        (conflictItem) => conflictItem.id === conflictId
      );
      if (!conflict) return content;
      return applyResolution(content, conflict, choice);
    },
    [conflicts, content]
  );

  // Get content with a specific conflict resolved (utility function)
  const getResolvedContent = useCallback(
    (
      sourceContent: string,
      conflictId: string,
      choice: ConflictResolutionChoice
    ): string => {
      const parsedConflicts = parseConflictBlocks(sourceContent);
      const conflict = parsedConflicts.find(
        (conflictItem) => conflictItem.id === conflictId
      );
      if (!conflict) return sourceContent;
      return applyResolution(sourceContent, conflict, choice);
    },
    []
  );

  return {
    conflicts,
    hasConflicts,
    conflictCount,
    resolvedCount,
    resolveConflict,
    getResolvedContent,
  };
}

// Export utilities for external use
export { parseConflictBlocks, applyResolution, hasConflictMarkers };
