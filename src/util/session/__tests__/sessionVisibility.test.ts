import { describe, expect, it } from "vitest";

import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

describe("isPrimarySessionListSession", () => {
  it("keeps Agent Org coordinator root sessions visible", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "sdeagent-root",
        orgMemberId: "coordinator",
        agentOrgId: "org-alpha",
      })
    ).toBe(true);
  });

  it("hides Agent Org member child sessions", () => {
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

  it("temporarily keeps GUI Control sessions visible for trajectory inspection", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "guicontrol-root:subagent:trajectory",
        parentSessionId: "osagent-root",
        orgMemberId: "internal-gui-control",
      })
    ).toBe(true);
  });
});
