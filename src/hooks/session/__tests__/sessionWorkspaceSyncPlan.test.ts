import {
  computeWorkspaceSyncPlan,
  nonIdeManagedPaths,
  trimTrailingSlashes,
} from "../sessionWorkspaceSyncPlan";

describe("sessionWorkspaceSyncPlan", () => {
  const ROOT = "/ws/repo-a";

  describe("trimTrailingSlashes", () => {
    it("strips trailing slashes only", () => {
      expect(trimTrailingSlashes("/a/b///")).toBe("/a/b");
      expect(trimTrailingSlashes("/a/b")).toBe("/a/b");
    });
  });

  describe("computeWorkspaceSyncPlan", () => {
    it("marks the session detached when workspaceRoot is not an IDE folder", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [{ path: "/ws/extra", source: "ideWorkspace" }],
        ideFolderPaths: ["/ws/other"],
      });
      expect(plan.detached).toBe(true);
      expect(plan.toAdd).toEqual([]);
      expect(plan.toRemove).toEqual([]);
    });

    it("adds IDE folders missing from the backend", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [],
        ideFolderPaths: [ROOT, "/ws/repo-b"],
      });
      expect(plan.detached).toBe(false);
      expect(plan.toAdd).toEqual(["/ws/repo-b"]);
      expect(plan.toRemove).toEqual([]);
    });

    it("removes ideWorkspace entries dropped from the IDE", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [{ path: "/ws/repo-b", source: "ideWorkspace" }],
        ideFolderPaths: [ROOT],
      });
      expect(plan.toRemove).toEqual(["/ws/repo-b"]);
    });

    it("never removes entries from other sources (H1 regression)", () => {
      // Agent ran `/add-dir /ws/agent-dir`; the IDE workspace does not
      // contain it. The sync layer must NOT revoke the grant.
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [
          { path: "/ws/agent-dir", source: "session" },
          { path: "/etc/settings-dir", source: "localSettings" },
          { path: "/usr/user-dir", source: "userSettings" },
          { path: "/cli/dir", source: "cliArg" },
        ],
        ideFolderPaths: [ROOT],
      });
      expect(plan.toRemove).toEqual([]);
      expect(plan.toAdd).toEqual([]);
    });

    it("does not re-add a path already present under another source", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [{ path: "/ws/repo-b", source: "session" }],
        ideFolderPaths: [ROOT, "/ws/repo-b"],
      });
      expect(plan.toAdd).toEqual([]);
      // ...and the session-sourced entry is also not removable.
      expect(plan.toRemove).toEqual([]);
    });

    it("trims trailing slashes on IDE paths before comparison", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [{ path: "/ws/repo-b", source: "ideWorkspace" }],
        ideFolderPaths: [`${ROOT}/`, "/ws/repo-b//"],
      });
      expect(plan.detached).toBe(false);
      expect(plan.toAdd).toEqual([]);
      expect(plan.toRemove).toEqual([]);
    });

    it("ignores empty IDE folder paths", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [],
        ideFolderPaths: ["", ROOT, "/"],
      });
      expect(plan.detached).toBe(false);
      expect(plan.toAdd).toEqual([]);
    });

    it("skips suppressed adds (no-op add already observed)", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [],
        ideFolderPaths: [ROOT, "/ws/symlinked"],
        suppressedAdds: new Set(["/ws/symlinked"]),
      });
      expect(plan.toAdd).toEqual([]);
    });

    it("handles mixed add+remove in one plan", () => {
      const plan = computeWorkspaceSyncPlan({
        workspaceRoot: ROOT,
        additionalDirectories: [
          { path: "/ws/old-ide", source: "ideWorkspace" },
          { path: "/ws/agent-dir", source: "session" },
        ],
        ideFolderPaths: [ROOT, "/ws/new-ide"],
      });
      expect(plan.toAdd).toEqual(["/ws/new-ide"]);
      expect(plan.toRemove).toEqual(["/ws/old-ide"]);
    });
  });

  describe("nonIdeManagedPaths", () => {
    it("returns sorted source-tagged paths excluding ideWorkspace", () => {
      expect(
        nonIdeManagedPaths([
          { path: "/b", source: "session" },
          { path: "/a", source: "cliArg" },
          { path: "/ide", source: "ideWorkspace" },
        ])
      ).toEqual(["cliArg:/a", "session:/b"]);
    });
  });
});
