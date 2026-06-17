import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

  it("hydrates optimistic session org context from launch readback", () => {
    const session = buildSessionFromLaunchResult({
      agentExecMode: "build",
      effectiveSource: null,
      isBackgroundLaunch: false,
      launchOrgContext: {
        orgId: "org-fallback",
        projectId: "project-fallback",
        projectName: "Fallback Project",
        projectSlug: "fallback-project",
        workItemId: "FB-1",
        agentRole: "custom",
      },
      result: {
        sessionId: "agent-1",
        category: DISPATCH_CATEGORY.RUST_AGENT,
        name: "Test session",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        userInput: "hello",
        background: false,
        orgId: "org-platform",
        projectId: "project-runtime",
        projectName: "Runtime",
        projectSlug: "runtime",
        workItemId: "RUN-12",
        agentRole: "reviewer",
      },
    });

    expect(session.orgId).toBe("org-platform");
    expect(session.projectId).toBe("project-runtime");
    expect(session.projectName).toBe("Runtime");
    expect(session.projectSlug).toBe("runtime");
    expect(session.workItemId).toBe("RUN-12");
    expect(session.agentRole).toBe("reviewer");
  });

  it("hydrates optimistic session org context from launch fallback before readback", () => {
    const session = buildSessionFromLaunchResult({
      agentExecMode: "build",
      effectiveSource: null,
      isBackgroundLaunch: false,
      launchOrgContext: {
        orgId: "org-platform",
        projectId: "project-runtime",
        projectName: "Runtime",
        projectSlug: "runtime",
        workItemId: "RUN-12",
        agentRole: "custom",
      },
      result: {
        sessionId: "agent-1",
        category: DISPATCH_CATEGORY.RUST_AGENT,
        name: "Test session",
        status: "running",
        createdAt: "2026-01-01T00:00:00.000Z",
        userInput: "hello",
        background: false,
      },
    });

    expect(session.orgId).toBe("org-platform");
    expect(session.projectId).toBe("project-runtime");
    expect(session.projectName).toBe("Runtime");
    expect(session.projectSlug).toBe("runtime");
    expect(session.workItemId).toBe("RUN-12");
    expect(session.agentRole).toBe("custom");
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
      adeContext: undefined,
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

  it("loose-matches repoPath against workspace folders (trailing slash + case)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { launchParams } = buildSessionLaunchPayload({
        ...baseLaunchOptions(),
        effectiveSource: {
          type: "local",
          repoId: "repo-a",
          repoName: "Repo A",
          repoPath: "/Workspace/Repo-A/",
        },
        workspaceFolders: [
          { path: "/workspace/repo-a" },
          { path: "/workspace/repo-b" },
        ],
      });

      expect(launchParams.additionalDirectories).toEqual(["/workspace/repo-b"]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("loose-matched"),
        expect.objectContaining({ sessionRepoPath: "/Workspace/Repo-A/" })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("drops additional directories with a warning when repoPath matches no folder", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { launchParams } = buildSessionLaunchPayload({
        ...baseLaunchOptions(),
        effectiveSource: {
          type: "local",
          repoId: "repo-x",
          repoName: "Repo X",
          repoPath: "/elsewhere/repo-x",
        },
        workspaceFolders: [
          { path: "/workspace/repo-a" },
          { path: "/workspace/repo-b" },
        ],
      });

      expect(launchParams.additionalDirectories).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("dropping additional directories"),
        expect.objectContaining({
          sessionRepoPath: "/elsewhere/repo-x",
          droppedDirectories: ["/workspace/repo-a", "/workspace/repo-b"],
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not block launched-session navigation on workspace-open side effects", () => {
    const launchHookPath = fileURLToPath(
      new URL(
        "../useSessionCreator/useSessionLaunch/index.tsx",
        import.meta.url
      )
    );
    const source = readFileSync(launchHookPath, "utf8");

    expect(source).toContain("void emitOpenWorkspace(");
    expect(source).not.toContain("await emitOpenWorkspace(");
  });
});

function baseLaunchOptions(): Parameters<typeof buildSessionLaunchPayload>[0] {
  return {
    agentExecMode: "build",
    agentInput: "hello",
    advancedConfig: {},
    dispatchCategory: DISPATCH_CATEGORY.RUST_AGENT,
    effectiveSource: null,
    adeContext: undefined,
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
    workspaceFolders: [],
  };
}
