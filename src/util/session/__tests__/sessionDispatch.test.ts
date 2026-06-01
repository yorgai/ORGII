import {
  CLI_SESSION_PREFIX,
  OS_AGENT_SESSION_PREFIX,
  SDE_AGENT_SESSION_PREFIX,
  getDispatchCategory,
  getRustAgentType,
  isAgentSession,
  isCliSession,
} from "../sessionDispatch";

describe("sessionDispatch constants", () => {
  it("exports expected prefix strings", () => {
    expect(OS_AGENT_SESSION_PREFIX).toBe("osagent-");
    expect(SDE_AGENT_SESSION_PREFIX).toBe("sdeagent-");
    expect(CLI_SESSION_PREFIX).toBe("cliagent-");
  });
});

describe("isCliSession", () => {
  it("returns true for cliagent prefix", () => {
    expect(isCliSession("cliagent-xyz")).toBe(true);
  });

  it("returns false for non-matching", () => {
    expect(isCliSession("osagent-x")).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isCliSession(null)).toBe(false);
    expect(isCliSession(undefined)).toBe(false);
  });
});

describe("isAgentSession", () => {
  it("returns true for sdeagent prefix", () => {
    expect(isAgentSession("sdeagent-1")).toBe(true);
  });

  it("returns true for osagent prefix", () => {
    expect(isAgentSession("osagent-1")).toBe(true);
  });

  it("returns false for non-matching", () => {
    expect(isAgentSession("cliagent-1")).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isAgentSession(null)).toBe(false);
    expect(isAgentSession(undefined)).toBe(false);
  });
});

describe("getDispatchCategory", () => {
  it("returns correct category per prefix", () => {
    expect(getDispatchCategory("osagent-x")).toBe("rust_agent");
    expect(getDispatchCategory("sdeagent-x")).toBe("rust_agent");
    expect(getDispatchCategory("cliagent-x")).toBe("cli_agent");
  });

  it("returns rust_agent for unknown id (default)", () => {
    expect(getDispatchCategory("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "rust_agent"
    );
  });
});

describe("getRustAgentType", () => {
  it("returns os for osagent prefix", () => {
    expect(getRustAgentType("osagent-abc")).toBe("os");
  });

  it("returns os for builtin:os defId", () => {
    expect(getRustAgentType("builtin:os")).toBe("os");
  });

  it("returns sde for sdeagent prefix", () => {
    expect(getRustAgentType("sdeagent-abc")).toBe("sde");
  });

  it("returns sde for builtin:sde defId", () => {
    expect(getRustAgentType("builtin:sde")).toBe("sde");
  });

  it("returns custom for cli prefix", () => {
    expect(getRustAgentType("cliagent-abc")).toBe("custom");
  });

  it("returns custom for unknown defId", () => {
    expect(getRustAgentType("builtin:gateway")).toBe("custom");
  });

  it("returns custom for null/undefined", () => {
    expect(getRustAgentType(null)).toBe("custom");
    expect(getRustAgentType(undefined)).toBe("custom");
  });
});
