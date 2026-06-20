import { describe, expect, it } from "vitest";

import {
  SESSION_TARGET_KIND,
  type SessionCreatorState,
  normalizeSessionCreatorState,
} from "../creatorStateAtom";

const defaultAgentOrgState: SessionCreatorState = {
  dispatchCategory: "rust_agent",
  targetKind: SESSION_TARGET_KIND.AGENT_ORG,
  source: null,
  selectedAgentDefinitionId: null,
  selectedAgentOrgId: "default:sde-feature-team",
  agentName: "Default Agent Team",
  agentIconId: "network",
  cliAgentType: null,
};

describe("normalizeSessionCreatorState", () => {
  it("uses SDE Agent instead of the built-in default Agent Team", () => {
    const normalized = normalizeSessionCreatorState(defaultAgentOrgState);

    expect(normalized.dispatchCategory).toBe("rust_agent");
    expect(normalized.targetKind).toBe(SESSION_TARGET_KIND.AGENT);
    expect(normalized.selectedAgentDefinitionId).toBe("builtin:sde");
    expect(normalized.selectedAgentOrgId).toBeNull();
    expect(normalized.agentName).toBe("SDE Agent");
    expect(normalized.agentIconId).toBe("code");
  });

  it("preserves a custom Agent Team selection", () => {
    const customOrgState: SessionCreatorState = {
      ...defaultAgentOrgState,
      selectedAgentOrgId: "custom-org",
      agentName: "Custom Org",
    };

    expect(normalizeSessionCreatorState(customOrgState)).toEqual(
      customOrgState
    );
  });
});
