import { describe, expect, it } from "vitest";

import {
  isAgentPtySessionId,
  toBackendPtySessionId,
} from "@src/util/ui/terminal/ptySessionId";

describe("ptySessionId", () => {
  it("maps regular UI terminal ids to spotlight PTY ids", () => {
    expect(toBackendPtySessionId("terminal-1")).toBe(
      "spotlight-pty-terminal-1"
    );
  });

  it("keeps agent PTY ids unchanged", () => {
    const agentPtySessionId = "agent-pty-terminalagent-123";

    expect(isAgentPtySessionId(agentPtySessionId)).toBe(true);
    expect(toBackendPtySessionId(agentPtySessionId)).toBe(agentPtySessionId);
  });

  it("does not treat read-only agent session tabs as PTY ids", () => {
    const readOnlyAgentTabId = "agent-session-osagent-123";

    expect(isAgentPtySessionId(readOnlyAgentTabId)).toBe(false);
    expect(toBackendPtySessionId(readOnlyAgentTabId)).toBe(
      "spotlight-pty-agent-session-osagent-123"
    );
  });
});
