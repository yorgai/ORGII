import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type SubagentJobMap,
  type SubagentJobState,
  hasLiveSubagentJobs,
  pruneSubagentJobsAtom,
  removeSubagentJobAtom,
  subagentJobMapAtom,
  updateSubagentJobAtom,
} from "@src/store/session/subagentJobAtom";

function job(handle: string): SubagentJobState {
  return {
    handle,
    agentName: "Explore",
    subagentType: "delegate",
    status: "running",
    startedAt: 0,
  };
}

describe("hasLiveSubagentJobs", () => {
  const parent = "sdeagent-parent";

  it("returns false for a null session id", () => {
    const map: SubagentJobMap = new Map([
      [parent, new Map([["h1", job("h1")]])],
    ]);
    expect(hasLiveSubagentJobs(map, null)).toBe(false);
  });

  it("returns false when the session has no bucket", () => {
    const map: SubagentJobMap = new Map();
    expect(hasLiveSubagentJobs(map, parent)).toBe(false);
  });

  it("returns false when the bucket is empty", () => {
    const map: SubagentJobMap = new Map([[parent, new Map()]]);
    expect(hasLiveSubagentJobs(map, parent)).toBe(false);
  });

  it("returns true when at least one live job exists for the session", () => {
    const map: SubagentJobMap = new Map([
      [parent, new Map([["h1", job("h1")]])],
    ]);
    expect(hasLiveSubagentJobs(map, parent)).toBe(true);
  });

  it("scopes to the requested parent session only", () => {
    const other = "sdeagent-other";
    const map: SubagentJobMap = new Map([
      [other, new Map([["h1", job("h1")]])],
    ]);
    expect(hasLiveSubagentJobs(map, parent)).toBe(false);
    expect(hasLiveSubagentJobs(map, other)).toBe(true);
  });
});

describe("pruneSubagentJobsAtom", () => {
  const parent = "sdeagent-parent";
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  function seed(...handles: string[]) {
    for (const h of handles) {
      store.set(updateSubagentJobAtom, {
        sessionId: parent,
        handle: h,
        agentName: "Explore",
        subagentType: "delegate",
        status: "running",
      });
    }
  }

  it("drops running rows whose handle is not in the live set", () => {
    seed("h1", "h2");
    store.set(pruneSubagentJobsAtom, { liveHandles: new Set(["h1"]) });
    const jobs = store.get(subagentJobMapAtom).get(parent);
    expect(jobs?.has("h1")).toBe(true);
    expect(jobs?.has("h2")).toBe(false);
  });

  it("removes the session bucket when all rows are pruned", () => {
    seed("h1");
    store.set(pruneSubagentJobsAtom, { liveHandles: new Set<string>() });
    expect(store.get(subagentJobMapAtom).has(parent)).toBe(false);
  });

  it("keeps all rows when every handle is still live", () => {
    seed("h1", "h2");
    store.set(pruneSubagentJobsAtom, {
      liveHandles: new Set(["h1", "h2"]),
    });
    expect(store.get(subagentJobMapAtom).get(parent)?.size).toBe(2);
  });
});

describe("removeSubagentJobAtom", () => {
  const parent = "sdeagent-parent";
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  it("force-removes a row by handle regardless of session", () => {
    store.set(updateSubagentJobAtom, {
      sessionId: parent,
      handle: "h1",
      agentName: "Explore",
      subagentType: "delegate",
      status: "running",
    });
    store.set(removeSubagentJobAtom, { handle: "h1" });
    expect(store.get(subagentJobMapAtom).has(parent)).toBe(false);
  });

  it("is a no-op when the handle does not exist", () => {
    store.set(updateSubagentJobAtom, {
      sessionId: parent,
      handle: "h1",
      agentName: "Explore",
      subagentType: "delegate",
      status: "running",
    });
    store.set(removeSubagentJobAtom, { handle: "nope" });
    expect(store.get(subagentJobMapAtom).get(parent)?.has("h1")).toBe(true);
  });
});
