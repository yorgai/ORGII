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

  it("hides imported child sessions with parent id in generic visibility filtering", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "claudecodeapp-child",
        parentSessionId: "claudecodeapp-parent",
        readOnly: true,
      })
    ).toBe(false);
  });

  it("accepts snake_case parent_session_id for child detection", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "opencodeapp-ses_child",
        parent_session_id: "opencodeapp-ses_1",
      })
    ).toBe(false);
  });

  it("does not let readOnly smuggle child sessions back into the sidebar", () => {
    expect(
      isPrimarySessionListSession({
        session_id: "opencodeapp-ses_child",
        parentSessionId: "opencodeapp-ses_1",
        readOnly: false,
      })
    ).toBe(false);
  });
});
