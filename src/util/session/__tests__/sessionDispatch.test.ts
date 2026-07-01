import {
  CLAUDE_CODE_HISTORY_SESSION_PREFIX,
  CLI_SESSION_PREFIX,
  CODEX_APP_SESSION_PREFIX,
  CURSOR_AGENT_HISTORY_SESSION_PREFIX,
  GEMINI_HISTORY_SESSION_PREFIX,
  OPENCODE_HISTORY_SESSION_PREFIX,
  OS_AGENT_SESSION_PREFIX,
  SDE_AGENT_SESSION_PREFIX,
  WINDSURF_HISTORY_SESSION_PREFIX,
  WORKBUDDY_HISTORY_SESSION_PREFIX,
  getDispatchCategory,
  getExternalHistorySourceId,
  getRustAgentType,
  isAgentSession,
  isClaudeCodeHistorySession,
  isCliSession,
  isCodexAppSession,
  isCursorAgentHistorySession,
  isExternalHistorySession,
  isGeminiHistorySession,
  isOpenCodeHistorySession,
  isWindsurfHistorySession,
  isWorkBuddyHistorySession,
} from "../sessionDispatch";

describe("sessionDispatch constants", () => {
  it("exports expected prefix strings", () => {
    expect(OS_AGENT_SESSION_PREFIX).toBe("osagent-");
    expect(SDE_AGENT_SESSION_PREFIX).toBe("sdeagent-");
    expect(CLI_SESSION_PREFIX).toBe("cliagent-");
    expect(CODEX_APP_SESSION_PREFIX).toBe("codexapp-");
    expect(CLAUDE_CODE_HISTORY_SESSION_PREFIX).toBe("claudecodeapp-");
    expect(CURSOR_AGENT_HISTORY_SESSION_PREFIX).toBe("cursoragentapp-");
    expect(OPENCODE_HISTORY_SESSION_PREFIX).toBe("opencodeapp-");
    expect(WINDSURF_HISTORY_SESSION_PREFIX).toBe("windsurfapp-");
    expect(WORKBUDDY_HISTORY_SESSION_PREFIX).toBe("workbuddyapp-");
    expect(GEMINI_HISTORY_SESSION_PREFIX).toBe("geminiapp-");
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
    expect(getDispatchCategory("codexapp-x")).toBe("external_history");
    expect(getDispatchCategory("claudecodeapp-x")).toBe("external_history");
    expect(getDispatchCategory("cursoragentapp-x")).toBe("external_history");
    expect(getDispatchCategory("opencodeapp-x")).toBe("external_history");
    expect(getDispatchCategory("windsurfapp-x")).toBe("external_history");
    expect(getDispatchCategory("workbuddyapp-x")).toBe("external_history");
    expect(getDispatchCategory("geminiapp-x")).toBe("external_history");
  });

  it("returns rust_agent for unknown id (default)", () => {
    expect(getDispatchCategory("550e8400-e29b-41d4-a716-446655440000")).toBe(
      "rust_agent"
    );
  });
});

describe("external history source detection", () => {
  it("recognizes Codex App imported history sessions", () => {
    expect(isExternalHistorySession("codexapp-rollout-1")).toBe(true);
    expect(isCodexAppSession("codexapp-rollout-1")).toBe(true);
    expect(getExternalHistorySourceId("codexapp-rollout-1")).toBe("codex_app");
  });

  it("recognizes Claude Code imported history sessions", () => {
    expect(isExternalHistorySession("claudecodeapp-session-1")).toBe(true);
    expect(isClaudeCodeHistorySession("claudecodeapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("claudecodeapp-session-1")).toBe(
      "claude_code"
    );
  });

  it("recognizes Cursor Agent imported history sessions", () => {
    expect(isExternalHistorySession("cursoragentapp-session-1")).toBe(true);
    expect(isCursorAgentHistorySession("cursoragentapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("cursoragentapp-session-1")).toBe(
      "cursor_agent"
    );
  });

  it("recognizes OpenCode imported history sessions", () => {
    expect(isExternalHistorySession("opencodeapp-session-1")).toBe(true);
    expect(isOpenCodeHistorySession("opencodeapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("opencodeapp-session-1")).toBe(
      "opencode"
    );
  });

  it("recognizes Windsurf imported history sessions", () => {
    expect(isExternalHistorySession("windsurfapp-session-1")).toBe(true);
    expect(isWindsurfHistorySession("windsurfapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("windsurfapp-session-1")).toBe(
      "windsurf"
    );
  });

  it("recognizes WorkBuddy imported history sessions", () => {
    expect(isExternalHistorySession("workbuddyapp-session-1")).toBe(true);
    expect(isWorkBuddyHistorySession("workbuddyapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("workbuddyapp-session-1")).toBe(
      "workbuddy"
    );
  });

  it("recognizes Gemini imported history sessions", () => {
    expect(isExternalHistorySession("geminiapp-session-1")).toBe(true);
    expect(isGeminiHistorySession("geminiapp-session-1")).toBe(true);
    expect(getExternalHistorySourceId("geminiapp-session-1")).toBe("gemini");
  });

  it("does not treat Cursor IDE as external history", () => {
    expect(isExternalHistorySession("cursoride-session-1")).toBe(false);
    expect(getExternalHistorySourceId("cursoride-session-1")).toBeUndefined();
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
