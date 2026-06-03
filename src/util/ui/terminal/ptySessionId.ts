const AGENT_PTY_SESSION_PREFIX = "agent-pty-";

export function isAgentPtySessionId(sessionId: string): boolean {
  return sessionId.startsWith(AGENT_PTY_SESSION_PREFIX);
}

export function toBackendPtySessionId(sessionId: string): string {
  return isAgentPtySessionId(sessionId)
    ? sessionId
    : `spotlight-pty-${sessionId}`;
}
