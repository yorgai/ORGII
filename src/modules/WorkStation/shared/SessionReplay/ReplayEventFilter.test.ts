import { describe, expect, it } from "vitest";

import {
  filterReplayTabsBySelection,
  getReplayEventFilterCategory,
} from "./ReplayEventFilter";
import type { ReplayTab } from "./ReplayTabBar";

function tab(kind: ReplayTab["kind"], eventId: string): ReplayTab {
  return {
    eventId,
    kind,
    label: eventId,
    title: eventId,
  };
}

describe("ReplayEventFilter", () => {
  const tabs = [
    tab("file", "file-1"),
    tab("terminal", "terminal-1"),
    tab("explore", "explore-1"),
    tab("tool", "tool-1"),
    tab("browser", "browser-1"),
  ];

  it("classifies replay tab kinds", () => {
    expect(getReplayEventFilterCategory(tab("file", "file"))).toBe(
      "file_changes"
    );
    expect(getReplayEventFilterCategory(tab("terminal", "terminal"))).toBe(
      "terminal"
    );
    expect(getReplayEventFilterCategory(tab("explore", "explore"))).toBe(
      "explore"
    );
    expect(getReplayEventFilterCategory(tab("tool", "tool"))).toBe("other");
    expect(getReplayEventFilterCategory(tab("browser", "browser"))).toBe(
      "key_interactions"
    );
  });

  it("keeps every tab for all-events selection", () => {
    expect(
      filterReplayTabsBySelection(tabs, "all").map((item) => item.eventId)
    ).toEqual(["file-1", "terminal-1", "explore-1", "tool-1", "browser-1"]);
  });

  it("filters a single category", () => {
    expect(
      filterReplayTabsBySelection(tabs, ["terminal"]).map(
        (item) => item.eventId
      )
    ).toEqual(["terminal-1"]);
  });

  it("filters multiple categories", () => {
    expect(
      filterReplayTabsBySelection(tabs, ["file_changes", "explore"]).map(
        (item) => item.eventId
      )
    ).toEqual(["file-1", "explore-1"]);
  });
});
