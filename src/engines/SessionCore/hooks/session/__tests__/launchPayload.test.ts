import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { SESSION_TARGET_KIND } from "@src/store/session";

import {
  buildSessionFromLaunchResult,
  buildSessionLaunchPayload,
} from "../useSessionCreator/useSessionLaunch/launchPayload";

describe("launchPayload", () => {
  it("persists launch workspacePath on the frontend session row", () => {
    const session = buildSessionFromLaunchResult({
      agentExecMode: "build",
      effectiveSource: {
        type: "local",
        repoId: "repo-1",
        repoName: "Repo One",
        repoPath: "/workspace/repo-one",
      },
      isBackgroundLaunch: false,
      result: {
        sessionId: "agent-1",
        category: DISPATCH_CATEGORY.RUST_AGENT,
        name: "Test session",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        userInput: "hello",
        workspacePath: "/workspace/repo-one",
        background: false,
      },
    });

    expect(session.repoPath).toBe("/workspace/repo-one");
  });

  it("passes non-primary multi-root folders as additional directories", () => {
    const { launchParams } = buildSessionLaunchPayload({
      agentExecMode: "build",
      agentInput: "hello",
      advancedConfig: {},
      dispatchCategory: DISPATCH_CATEGORY.RUST_AGENT,
      effectiveSource: {
        type: "local",
        repoId: "repo-a",
        repoName: "Repo A",
        repoPath: "/workspace/repo-a",
      },
      ideContext: undefined,
      imageDataUrls: undefined,
      isBackgroundLaunch: false,
      resolvedKeys: {
        accountId: "account-1",
        keySource: "own_key",
        model: "model-1",
        cliAgentType: undefined,
        nativeHarnessType: undefined,
        branch: undefined,
      },
      runningLocation: "local",
      selectedAgentDefId: "builtin:sde",
      selectedAgentOrgId: null,
      selectedWorktreePath: null,
      sessionName: "Test session",
      targetKind: SESSION_TARGET_KIND.AGENT,
      workspaceFolders: [
        { path: "/workspace/repo-a" },
        { path: "/workspace/repo-b" },
      ],
    });

    expect(launchParams.workspacePath).toBe("/workspace/repo-a");
    expect(launchParams.additionalDirectories).toEqual(["/workspace/repo-b"]);
  });
});
