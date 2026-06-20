import { describe, expect, it } from "vitest";

import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

describe("isPrimarySessionListSession", () => {
  it("keeps Agent Team coordinator root sessions visible", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "sdeagent-root",
        orgMemberId: "coordinator",
        agentOrgId: "org-alpha",
      })
    ).toBe(true);
  });

  it("hides Agent Team member child sessions", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "sdeagent-root:subagent:planner",
        orgMemberId: "planner",
        parentSessionId: "sdeagent-root",
      })
    ).toBe(false);
  });

  it("hides regular subagent child sessions", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "sdeagent-root:subagent:reviewer",
      })
    ).toBe(false);
  });

  it("keeps ADE Manager sessions visible (singleton, no orgMemberId)", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "agentsession-ade-manager-abc",
      })
    ).toBe(true);
  });
});
