/**
 * Tests for the WorkStation pipeline bridge.
 *
 * These exercise the pure `applyWorkStationPipelineBridge` helper so
 * we don't need a DOM/React env. The wrapping `useEffect` in the hook
 * just calls this function with the same arguments.
 */
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

async function loadModule() {
  const { createInstrumentedStore } =
    await import("@src/util/core/state/instrumentedStore");
  createInstrumentedStore();
  const atoms = await import("@src/store/session");
  const bridge = await import("../useWorkStationPipelineBridge");
  return {
    activeSessionIdAtom: atoms.activeSessionIdAtom,
    workstationActiveSessionIdAtom: atoms.workstationActiveSessionIdAtom,
    sessionViewAtom: atoms.sessionViewAtom,
    applyWorkStationPipelineBridge: bridge.applyWorkStationPipelineBridge,
  };
}

describe("applyWorkStationPipelineBridge", () => {
  it("does nothing when the WorkStation view is not active", async () => {
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "kanban-claimed");

    const acted = applyWorkStationPipelineBridge(false, "memory-A", store);

    expect(acted).toBe(false);
    expect(store.get(activeSessionIdAtom)).toBe("kanban-claimed");
  });

  it("does not reassert memory when the primary WorkStation chat is inactive", async () => {
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "kanban-mini-chat");

    const acted = applyWorkStationPipelineBridge(
      false,
      "workstation-memory",
      store
    );

    expect(acted).toBe(false);
    expect(store.get(activeSessionIdAtom)).toBe("kanban-mini-chat");
  });

  it("re-asserts memory into pipeline on transition into WorkStation", async () => {
    // Scenario: user is in WorkStation (memory=A); they navigate to
    // kanban which claims pipeline=B; they return to WorkStation —
    // the bridge fires and pulls pipeline back to A.
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "kanban-B");

    const acted = applyWorkStationPipelineBridge(true, "workstation-A", store);

    expect(acted).toBe(true);
    expect(store.get(activeSessionIdAtom)).toBe("workstation-A");
  });

  it("no-ops when memory and pipeline already match", async () => {
    // The most common case: WorkStation owners already wrote both
    // atoms in lockstep, so when this effect fires the values agree.
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "same");

    const acted = applyWorkStationPipelineBridge(true, "same", store);

    expect(acted).toBe(false);
    expect(store.get(activeSessionIdAtom)).toBe("same");
  });

  it("propagates a null memory into the pipeline (close session)", async () => {
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "lingering");

    const acted = applyWorkStationPipelineBridge(true, null, store);

    expect(acted).toBe(true);
    expect(store.get(activeSessionIdAtom)).toBeNull();
  });

  it("recovers from a non-WorkStation pipeline write while in WorkStation", async () => {
    // Scenario: user is in WorkStation (memory=A, pipeline=A). Some
    // overlay or background handler writes pipeline=B WITHOUT
    // changing the view mode. Next time the effect runs (because the
    // memory atom subscription triggers it, e.g. from an unrelated
    // memory update OR a focus event), the bridge restores pipeline.
    //
    // We simulate "next run" by just calling the function again.
    const { activeSessionIdAtom, applyWorkStationPipelineBridge } =
      await loadModule();
    const store = createStore();
    store.set(activeSessionIdAtom, "A");

    // Initial run: in sync, no-op.
    expect(applyWorkStationPipelineBridge(true, "A", store)).toBe(false);

    // Some other code claims the pipeline.
    store.set(activeSessionIdAtom, "B");

    // Bridge fires again — restores.
    expect(applyWorkStationPipelineBridge(true, "A", store)).toBe(true);
    expect(store.get(activeSessionIdAtom)).toBe("A");
  });

  it("(integration) reading workstationActiveSessionIdAtom + applying bridge round-trips correctly", async () => {
    // End-to-end: write the workstation memory atom; the bridge
    // reads it and pushes it into the pipeline. Verifies the two
    // atoms are wired the way the hook expects.
    const {
      activeSessionIdAtom,
      workstationActiveSessionIdAtom,
      applyWorkStationPipelineBridge,
    } = await loadModule();
    const store = createStore();

    store.set(workstationActiveSessionIdAtom, "via-memory-atom");
    const remembered = store.get(workstationActiveSessionIdAtom);

    applyWorkStationPipelineBridge(true, remembered, store);

    expect(store.get(activeSessionIdAtom)).toBe("via-memory-atom");
  });

  // Suppress unused-warning for the storage mock (it's referenced via
  // the side-effect of being installed before the module loads).
  void STORAGE_KEY;
  void memoryStore;
});
