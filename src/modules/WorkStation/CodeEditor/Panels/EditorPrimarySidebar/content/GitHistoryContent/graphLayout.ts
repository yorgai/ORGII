/**
 * Git Graph Lane Assignment Algorithm
 *
 * Assigns each commit to a "lane" (column) and computes line segments
 * for rendering a metro-style git graph from parent_shas topology.
 *
 * Supports incremental computation: process new commits without
 * recomputing existing ones (stable references for already-rendered rows).
 *
 * Key insights from git-graph (https://github.com/git-bahn/git-graph):
 * - First parent always continues in the same lane (main line stays straight)
 * - Merge parents open a new lane only if not already reserved elsewhere
 * - A lane closes when the branch merges back (first parent already in another lane)
 * - Lanes are reused via interval scheduling (freed lanes get reassigned)
 */
import type { GitCommitInfo } from "@src/api/http/git/types";

// ============================================
// Constants
// ============================================

/** Maximum number of lanes to prevent overflow in narrow sidebar */
const MAX_LANES = 6;

/** Width of each lane column in pixels */
export const LANE_WIDTH = 14;

/** Radius of the commit dot */
export const DOT_RADIUS = 4;

/** Lane color palette — cycles for lanes beyond the palette length */
export const LANE_COLORS = [
  "var(--color-primary-6)", // blue
  "#E5A84B", // orange
  "#67C23A", // green
  "#F56C6C", // red
  "#9B59B6", // purple
  "#1ABC9C", // teal
];

// ============================================
// Types
// ============================================

/** A line segment to draw in a commit row's SVG */
export interface GraphLine {
  /** Starting lane index (x position) */
  fromLane: number;
  /** Ending lane index (x position) */
  toLane: number;
  /** "top" = line from top edge to center, "bottom" = line from center to bottom edge */
  segment: "top" | "bottom";
  /** Color of this line */
  color: string;
}

/** Layout data for a single commit row */
export interface CommitGraphNode {
  /** The commit this node represents */
  commit: GitCommitInfo;
  /** Lane index (column) for the commit dot */
  lane: number;
  /** Color for the commit dot */
  color: string;
  /** Line segments to draw in this row */
  lines: GraphLine[];
  /** Number of active lanes at this row (determines SVG width) */
  activeLaneCount: number;
}

/**
 * Persistent state for incremental graph computation.
 * Store in a ref to resume processing when new commits are appended.
 */
export interface GraphState {
  /** Lane reservations: lanes[i] = SHA expected next, or null if free */
  lanes: (string | null)[];
  /** Already-computed graph nodes (stable references) */
  nodes: CommitGraphNode[];
  /** Number of commits already processed */
  processedCount: number;
}

// ============================================
// Lane Assignment
// ============================================

function getLaneColor(laneIndex: number): string {
  return LANE_COLORS[laneIndex % LANE_COLORS.length];
}

/** Allocate a lane: reuse a free (null) slot or append a new one (capped) */
function allocateLane(lanes: (string | null)[]): number {
  for (let idx = 0; idx < lanes.length; idx++) {
    if (lanes[idx] === null) return idx;
  }
  if (lanes.length < MAX_LANES) {
    lanes.push(null);
    return lanes.length - 1;
  }
  return MAX_LANES - 1;
}

/** Remove trailing null lanes to keep the array compact */
function trimLanes(lanes: (string | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
    lanes.pop();
  }
}

/** Create a fresh graph state */
export function createGraphState(): GraphState {
  return { lanes: [], nodes: [], processedCount: 0 };
}

/**
 * Incrementally assign lanes to new commits.
 *
 * Resumes from `state.processedCount`, only processing commits
 * at indices >= processedCount. Already-computed nodes keep their
 * object references (no re-render for existing rows).
 *
 * Mutates `state` in place for efficiency.
 */
export function assignLanesIncremental(
  state: GraphState,
  commits: GitCommitInfo[]
): void {
  if (commits.length <= state.processedCount) return;

  const { lanes, nodes } = state;

  for (
    let commitIdx = state.processedCount;
    commitIdx < commits.length;
    commitIdx++
  ) {
    const commit = commits[commitIdx];
    const lines: GraphLine[] = [];
    const isFirstRow = commitIdx === 0;

    // Step 1: Find which lane this commit belongs to
    let commitLane = lanes.indexOf(commit.sha);

    if (commitLane === -1) {
      commitLane = allocateLane(lanes);
    }

    // Fulfill this lane's reservation
    lanes[commitLane] = null;

    // Step 2: Draw incoming line from above (skip for first row)
    if (!isFirstRow) {
      lines.push({
        fromLane: commitLane,
        toLane: commitLane,
        segment: "top",
        color: getLaneColor(commitLane),
      });
    }

    // Step 3: Draw pass-through lines for other active lanes
    for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
      if (lanes[laneIdx] !== null && laneIdx !== commitLane) {
        lines.push({
          fromLane: laneIdx,
          toLane: laneIdx,
          segment: "top",
          color: getLaneColor(laneIdx),
        });
        lines.push({
          fromLane: laneIdx,
          toLane: laneIdx,
          segment: "bottom",
          color: getLaneColor(laneIdx),
        });
      }
    }

    // Step 4: Process parents
    const parents = commit.parent_shas ?? [];

    for (let parentIdx = 0; parentIdx < parents.length; parentIdx++) {
      const parentSha = parents[parentIdx];

      if (parentIdx === 0) {
        // First parent handling
        const existingParentLane = lanes.indexOf(parentSha);

        if (existingParentLane !== -1 && existingParentLane !== commitLane) {
          // Parent already in a DIFFERENT lane → branch merges back, close this lane
          lines.push({
            fromLane: commitLane,
            toLane: existingParentLane,
            segment: "bottom",
            color: getLaneColor(commitLane),
          });
        } else {
          // Continue in same lane (or parent not reserved yet)
          lanes[commitLane] = parentSha;
          lines.push({
            fromLane: commitLane,
            toLane: commitLane,
            segment: "bottom",
            color: getLaneColor(commitLane),
          });
        }
      } else {
        // Additional parents (merge source)
        const existingLane = lanes.indexOf(parentSha);

        if (existingLane !== -1) {
          // Parent already reserved — draw diagonal
          lines.push({
            fromLane: commitLane,
            toLane: existingLane,
            segment: "bottom",
            color: getLaneColor(existingLane),
          });
        } else {
          // Allocate new lane for merge source
          const newLane = allocateLane(lanes);
          lanes[newLane] = parentSha;
          lines.push({
            fromLane: commitLane,
            toLane: newLane,
            segment: "bottom",
            color: getLaneColor(newLane),
          });
        }
      }
    }

    // Step 5: Compact lanes
    trimLanes(lanes);

    const activeLaneCount = Math.max(1, lanes.length, commitLane + 1);

    nodes.push({
      commit,
      lane: commitLane,
      color: getLaneColor(commitLane),
      lines,
      activeLaneCount,
    });
  }

  state.processedCount = commits.length;
}
