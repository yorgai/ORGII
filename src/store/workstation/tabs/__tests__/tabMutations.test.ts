/**
 * Pure tab mutation helpers (panel tab strip).
 */
import { describe, expect, it } from "vitest";

import {
  closeTab,
  openTab,
  reorderTabs,
  switchTab,
  updateTabData,
} from "../tabMutations";
import { TAB_RETURN_TARGET_DATA_KEY } from "../types";
import type { PanelState, WorkStationTab } from "../types";

function tab(
  overrides: Partial<WorkStationTab> & Pick<WorkStationTab, "id">
): WorkStationTab {
  return {
    type: "file",
    title: overrides.id,
    data: {},
    ...overrides,
  };
}

const empty: PanelState = { tabs: [], activeTabId: null };

describe("openTab", () => {
  it("appends a new tab and activates it", () => {
    const next = openTab(empty, tab({ id: "file:a.ts" }));
    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe("file:a.ts");
  });

  it("switches active tab when the id already exists", () => {
    const state: PanelState = {
      tabs: [tab({ id: "file:a.ts" }), tab({ id: "file:b.ts" })],
      activeTabId: "file:a.ts",
    };
    const next = openTab(state, tab({ id: "file:b.ts" }));
    expect(next.tabs).toHaveLength(2);
    expect(next.activeTabId).toBe("file:b.ts");
  });

  it("updates targetLine on an existing tab when provided", () => {
    const state: PanelState = {
      tabs: [tab({ id: "file:a.ts", data: { path: "/a.ts" } })],
      activeTabId: "file:a.ts",
    };
    const next = openTab(
      state,
      tab({ id: "file:a.ts", data: { targetLine: 42 } })
    );
    expect(next.tabs[0].data.targetLine).toBe(42);
    expect(next.activeTabId).toBe("file:a.ts");
  });
});

describe("closeTab", () => {
  it("removes the tab and activates a neighbor when the active tab closes", () => {
    const state: PanelState = {
      tabs: [
        tab({ id: "file:a.ts" }),
        tab({ id: "file:b.ts" }),
        tab({ id: "file:c.ts" }),
      ],
      activeTabId: "file:b.ts",
    };
    const next = closeTab(state, "file:b.ts");
    expect(next.tabs.map((t) => t.id)).toEqual(["file:a.ts", "file:c.ts"]);
    expect(next.activeTabId).toBe("file:c.ts");
  });

  it("returns to the source tab when the closed active tab has a return target", () => {
    const state: PanelState = {
      tabs: [
        tab({ id: "project-dashboard:main" }),
        tab({ id: "project-work-items:org:personal-org" }),
        tab({
          id: "workItem-detail:wi-1",
          data: {
            [TAB_RETURN_TARGET_DATA_KEY]: "project-work-items:org:personal-org",
          },
        }),
      ],
      activeTabId: "workItem-detail:wi-1",
    };
    const next = closeTab(state, "workItem-detail:wi-1");
    expect(next.tabs.map((item) => item.id)).toEqual([
      "project-dashboard:main",
      "project-work-items:org:personal-org",
    ]);
    expect(next.activeTabId).toBe("project-work-items:org:personal-org");
  });

  it("returns empty panel when the last tab closes", () => {
    const state: PanelState = {
      tabs: [tab({ id: "file:a.ts" })],
      activeTabId: "file:a.ts",
    };
    const next = closeTab(state, "file:a.ts");
    expect(next.tabs).toHaveLength(0);
    expect(next.activeTabId).toBeNull();
  });
});

describe("switchTab", () => {
  it("no-ops when the tab id is missing", () => {
    const state: PanelState = {
      tabs: [tab({ id: "file:a.ts" })],
      activeTabId: "file:a.ts",
    };
    const next = switchTab(state, "missing");
    expect(next).toEqual(state);
  });
});

describe("reorderTabs", () => {
  it("moves a tab from startIndex to endIndex", () => {
    const state: PanelState = {
      tabs: [tab({ id: "t1" }), tab({ id: "t2" }), tab({ id: "t3" })],
      activeTabId: "t2",
    };
    const next = reorderTabs(state, 0, 2);
    expect(next.tabs.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
    expect(next.activeTabId).toBe("t2");
  });
});

describe("updateTabData", () => {
  it("merges data for the matching tab id", () => {
    const state: PanelState = {
      tabs: [tab({ id: "file:a.ts", data: { path: "/a.ts" } })],
      activeTabId: "file:a.ts",
    };
    const next = updateTabData(state, "file:a.ts", { scrollTop: 10 });
    expect(next.tabs[0].data).toEqual({ path: "/a.ts", scrollTop: 10 });
  });
});
