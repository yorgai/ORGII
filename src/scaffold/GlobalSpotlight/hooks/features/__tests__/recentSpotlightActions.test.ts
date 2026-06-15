/**
 * Recent Spotlight Actions — pure list logic.
 *
 * Covers the "Recently used" ordering rules used by the global palette:
 *   - de-duplicating + promoting a re-used command to the top
 *   - capping the list length (oldest entries drop off)
 *   - resolving persisted ids back to definitions, skipping unknown ids
 */
import { describe, expect, it } from "vitest";

import {
  RECENT_SPOTLIGHT_ACTIONS_CAP,
  addRecentActionId,
  resolveRecentDefinitions,
} from "../recentSpotlightActions";

describe("addRecentActionId", () => {
  it("adds the first id to an empty list", () => {
    expect(addRecentActionId([], "toggle-sidebar")).toEqual(["toggle-sidebar"]);
  });

  it("prepends a new id, most-recent-first", () => {
    expect(addRecentActionId(["zoom-in"], "toggle-sidebar")).toEqual([
      "toggle-sidebar",
      "zoom-in",
    ]);
  });

  it("moves a re-used id to the top without duplicating it", () => {
    const next = addRecentActionId(["zoom-in", "toggle-sidebar"], "zoom-in");
    expect(next).toEqual(["zoom-in", "toggle-sidebar"]);
    expect(next.filter((id) => id === "zoom-in")).toHaveLength(1);
  });

  it("drops the oldest entry once the cap is exceeded", () => {
    const next = addRecentActionId(["d", "c", "b", "a"], "e", 4);
    expect(next).toEqual(["e", "d", "c", "b"]);
    expect(next).toHaveLength(4);
  });

  it("does not grow past the cap when re-adding an existing id at capacity", () => {
    const atCapacity = ["a", "b", "c", "d", "e", "f"];
    expect(atCapacity).toHaveLength(RECENT_SPOTLIGHT_ACTIONS_CAP);
    const next = addRecentActionId(atCapacity, "f");
    expect(next).toEqual(["f", "a", "b", "c", "d", "e"]);
    expect(next).toHaveLength(RECENT_SPOTLIGHT_ACTIONS_CAP);
  });

  it("returns an empty list when the cap is zero or negative", () => {
    expect(addRecentActionId(["a"], "b", 0)).toEqual([]);
    expect(addRecentActionId(["a"], "b", -3)).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const input = ["a", "b"];
    addRecentActionId(input, "a");
    expect(input).toEqual(["a", "b"]);
  });
});

describe("resolveRecentDefinitions", () => {
  const definitions = [
    { id: "toggle-sidebar", label: "Toggle sidebar" },
    { id: "zoom-in", label: "Zoom in" },
    { id: "detect-update", label: "Detect update" },
  ];

  it("returns an empty list when there are no recent ids", () => {
    expect(resolveRecentDefinitions([], definitions)).toEqual([]);
  });

  it("resolves ids back to definitions preserving recent order", () => {
    expect(
      resolveRecentDefinitions(["zoom-in", "toggle-sidebar"], definitions)
    ).toEqual([
      { id: "zoom-in", label: "Zoom in" },
      { id: "toggle-sidebar", label: "Toggle sidebar" },
    ]);
  });

  it("skips ids that no longer map to a known definition", () => {
    expect(
      resolveRecentDefinitions(
        ["zoom-in", "removed-command", "detect-update"],
        definitions
      )
    ).toEqual([
      { id: "zoom-in", label: "Zoom in" },
      { id: "detect-update", label: "Detect update" },
    ]);
  });

  it("returns an empty list when every id is stale", () => {
    expect(resolveRecentDefinitions(["gone-1", "gone-2"], definitions)).toEqual(
      []
    );
  });
});
