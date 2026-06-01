import { createStore } from "jotai/vanilla";
import { beforeEach, vi } from "vitest";

const STORAGE_KEY = "orgii-v2-session-view";

type StorageMap = Record<string, string>;

function installMemoryLocalStorage(): StorageMap {
  const store: StorageMap = {};
  const mock: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = mock;
  return store;
}

let memoryStore: StorageMap = installMemoryLocalStorage();

beforeEach(() => {
  memoryStore = installMemoryLocalStorage();
  vi.resetModules();
});

async function loadAtoms() {
  // `jumpToSessionAtom` calls `markSessionVisited`, which reads the
  // global instrumented Jotai store. Tests don't render the AppShell
  // (which would normally bootstrap it), so we need to call
  // `createInstrumentedStore()` first to satisfy that dependency.
  // Each `vi.resetModules()` invalidates the cached module so we
  // re-bootstrap inside `loadAtoms`.
  const { createInstrumentedStore } =
    await import("@src/util/core/state/instrumentedStore");
  createInstrumentedStore();
  const mod = await import("../viewAtom");
  return {
    sessionViewAtom: mod.sessionViewAtom,
    activeSessionIdAtom: mod.activeSessionIdAtom,
    workstationActiveSessionIdAtom: mod.workstationActiveSessionIdAtom,
    jumpToSessionAtom: mod.jumpToSessionAtom,
    openSessionAtom: mod.openSessionAtom,
    closeSessionAtom: mod.closeSessionAtom,
  };
}

describe("sessionViewAtom cold-start hydration", () => {
  it("exposes null activeSessionId by default", async () => {
    const { activeSessionIdAtom } = await loadAtoms();
    const store = createStore();
    expect(store.get(activeSessionIdAtom)).toBeNull();
  });

  it("ignores persisted activeSessionId from a previous app run", async () => {
    memoryStore[STORAGE_KEY] = JSON.stringify({
      activeSessionId: "osagent-stale-from-last-run",
      sessionName: "Stale",
      repoPath: undefined,
    });

    const { activeSessionIdAtom, sessionViewAtom } = await loadAtoms();
    const store = createStore();
    const view = store.get(sessionViewAtom);
    const activeId = store.get(activeSessionIdAtom);

    expect(activeId).toBeNull();
    expect(view.activeSessionId).toBeNull();
  });

  it("still restores sessionName and repoPath from persisted state", async () => {
    memoryStore[STORAGE_KEY] = JSON.stringify({
      activeSessionId: "osagent-stale",
      sessionName: "Earlier label",
      repoPath: "/tmp/repo",
    });

    const { sessionViewAtom } = await loadAtoms();
    const store = createStore();
    const view = store.get(sessionViewAtom);

    expect(view.sessionName).toBe("Earlier label");
    expect(view.repoPath).toBe("/tmp/repo");
  });

  it("supports explicit user action writes after cold start", async () => {
    const { activeSessionIdAtom } = await loadAtoms();
    const store = createStore();
    store.set(activeSessionIdAtom, "cliagent-just-opened");
    expect(store.get(activeSessionIdAtom)).toBe("cliagent-just-opened");
  });
});

// ---------------------------------------------------------------------------
// Two-atom dual-write semantics
// ---------------------------------------------------------------------------
//
// Every "WorkStation owner" action must update both
// `workstationActiveSessionIdAtom` (the persisted memory) AND
// `activeSessionIdAtom` (the transient pipeline) in lockstep. If either of
// these tests ever fails, a kanban (or other secondary) surface that
// claims the pipeline alone will permanently hijack what WorkStation
// shows on its next visible frame — the exact regression the split was
// introduced to prevent.
// ---------------------------------------------------------------------------

describe("jumpToSessionAtom", () => {
  it("writes both workstation memory and pipeline atoms (string payload)", async () => {
    const {
      jumpToSessionAtom,
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
    } = await loadAtoms();
    const store = createStore();

    store.set(jumpToSessionAtom, "osagent-target");

    expect(store.get(workstationActiveSessionIdAtom)).toBe("osagent-target");
    expect(store.get(activeSessionIdAtom)).toBe("osagent-target");
  });

  it("clears both atoms when jumping to null", async () => {
    const {
      jumpToSessionAtom,
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
      sessionViewAtom,
    } = await loadAtoms();
    const store = createStore();

    store.set(sessionViewAtom, {
      activeSessionId: "previously-active",
      sessionName: undefined,
      repoPath: undefined,
    });
    store.set(activeSessionIdAtom, "previously-active");

    store.set(jumpToSessionAtom, null);

    expect(store.get(workstationActiveSessionIdAtom)).toBeNull();
    expect(store.get(activeSessionIdAtom)).toBeNull();
  });

  it("accepts rich payload to fold name + repoPath into a single write", async () => {
    const { jumpToSessionAtom, sessionViewAtom, activeSessionIdAtom } =
      await loadAtoms();
    const store = createStore();

    store.set(jumpToSessionAtom, {
      sessionId: "osagent-rich",
      sessionName: "Refactor pass",
      repoPath: "/repos/orgii",
    });

    const view = store.get(sessionViewAtom);
    expect(view.activeSessionId).toBe("osagent-rich");
    expect(view.sessionName).toBe("Refactor pass");
    expect(view.repoPath).toBe("/repos/orgii");
    expect(store.get(activeSessionIdAtom)).toBe("osagent-rich");
  });

  it("preserves existing sessionName/repoPath when called with bare string", async () => {
    const { jumpToSessionAtom, sessionViewAtom } = await loadAtoms();
    const store = createStore();

    store.set(sessionViewAtom, {
      activeSessionId: "first",
      sessionName: "Existing label",
      repoPath: "/repos/keep-me",
    });

    store.set(jumpToSessionAtom, "second");

    const view = store.get(sessionViewAtom);
    expect(view.activeSessionId).toBe("second");
    expect(view.sessionName).toBe("Existing label");
    expect(view.repoPath).toBe("/repos/keep-me");
  });
});

describe("openSessionAtom", () => {
  it("writes workstation memory and pipeline + carries metadata", async () => {
    const {
      openSessionAtom,
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
      sessionViewAtom,
    } = await loadAtoms();
    const store = createStore();

    store.set(openSessionAtom, {
      sessionId: "cliagent-open",
      sessionName: "Code review",
      repoPath: "/repos/x",
    });

    expect(store.get(workstationActiveSessionIdAtom)).toBe("cliagent-open");
    expect(store.get(activeSessionIdAtom)).toBe("cliagent-open");
    const view = store.get(sessionViewAtom);
    expect(view.sessionName).toBe("Code review");
    expect(view.repoPath).toBe("/repos/x");
  });
});

describe("closeSessionAtom", () => {
  it("clears both workstation memory and pipeline", async () => {
    const {
      closeSessionAtom,
      sessionViewAtom,
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
    } = await loadAtoms();
    const store = createStore();

    store.set(sessionViewAtom, {
      activeSessionId: "to-be-closed",
      sessionName: "Doomed",
      repoPath: "/repos/x",
    });
    store.set(activeSessionIdAtom, "to-be-closed");

    store.set(closeSessionAtom);

    expect(store.get(workstationActiveSessionIdAtom)).toBeNull();
    expect(store.get(activeSessionIdAtom)).toBeNull();
    const view = store.get(sessionViewAtom);
    expect(view.sessionName).toBeUndefined();
    expect(view.repoPath).toBeUndefined();
  });
});

describe("pipeline / memory independence", () => {
  it("a pipeline-only write does NOT touch workstation memory", async () => {
    // This is the *key invariant* enabling kanban detail panels (and
    // any other secondary surface) to claim the live event stream
    // without permanently changing what WorkStation will show next.
    const { activeSessionIdAtom, workstationActiveSessionIdAtom } =
      await loadAtoms();
    const store = createStore();

    // Cold start: both null. Write pipeline only.
    store.set(activeSessionIdAtom, "kanban-clicked-session");

    expect(store.get(activeSessionIdAtom)).toBe("kanban-clicked-session");
    expect(store.get(workstationActiveSessionIdAtom)).toBeNull();
  });

  it("a memory-only write does NOT touch pipeline", async () => {
    const {
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
      sessionViewAtom,
    } = await loadAtoms();
    const store = createStore();

    store.set(workstationActiveSessionIdAtom, "stored-by-bridge");

    expect(store.get(workstationActiveSessionIdAtom)).toBe("stored-by-bridge");
    expect(store.get(sessionViewAtom).activeSessionId).toBe("stored-by-bridge");
    // Pipeline untouched — stays null until a chat surface or the
    // WorkStation bridge effect re-asserts it.
    expect(store.get(activeSessionIdAtom)).toBeNull();
  });
});
