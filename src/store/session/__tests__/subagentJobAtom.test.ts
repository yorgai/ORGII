import { describe, expect, it } from "vitest";

import {
  type SubagentJobMap,
  type SubagentJobState,
  hasLiveSubagentJobs,
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
