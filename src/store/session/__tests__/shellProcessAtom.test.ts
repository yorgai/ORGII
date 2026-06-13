import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import { findStaleShellProcesses } from "@src/hooks/terminal/useProcessReconciliation";

import {
  shellProcessMapAtom,
  updateShellProcessAtom,
} from "../shellProcessAtom";

describe("shellProcessAtom", () => {
  it("marks frontend-only running processes as exited during reconciliation", () => {
    const store = createStore();

    store.set(updateShellProcessAtom, {
      type: "start",
      sessionId: "session-live",
      pid: 1001,
      command: "sleep 180",
    });
    store.set(updateShellProcessAtom, {
      type: "start",
      sessionId: "session-stale",
      pid: 1002,
      command: "sleep 180",
    });
    store.set(updateShellProcessAtom, {
      type: "background",
      sessionId: "session-stale",
      pid: 1002,
    });

    const staleProcesses = findStaleShellProcesses(
      store.get(shellProcessMapAtom),
      [
        {
          session_id: "session-live",
          pid: 1001,
          command: "sleep 180",
          log_path: null,
        },
      ]
    );

    expect(staleProcesses).toEqual([{ sessionId: "session-stale", pid: 1002 }]);

    for (const process of staleProcesses) {
      store.set(updateShellProcessAtom, {
        type: "exit",
        sessionId: process.sessionId,
        pid: process.pid,
        killed: false,
      });
    }

    const processMap = store.get(shellProcessMapAtom);
    expect(processMap.get("session-live")?.get(1001)?.status).toBe("running");
    expect(processMap.get("session-stale")?.get(1002)?.status).toBe("exited");
  });
});
