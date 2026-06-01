/**
 * Command detection map atom: per-terminal session command history.
 */
import { createStore } from "jotai/vanilla";
import { describe, expect, it } from "vitest";

import {
  commandCwdChangedAtom,
  commandDetectionForSessionAtom,
  commandDetectionMapAtom,
  commandExecutedAtom,
  commandFinishedAtom,
  commandPromptStartAtom,
  removeCommandDetectionAtom,
} from "../commandDetection";

describe("commandDetection atoms", () => {
  it("tracks cwd and command lifecycle for a session", () => {
    const store = createStore();
    const sessionId = "term-session-1";

    store.set(commandCwdChangedAtom, { sessionId, cwd: "/proj" });
    store.set(commandPromptStartAtom, sessionId);
    store.set(commandExecutedAtom, {
      sessionId,
      commandLine: "npm test",
    });
    store.set(commandFinishedAtom, { sessionId, exitCode: 0 });

    const readSession = store.get(commandDetectionForSessionAtom);
    const state = readSession(sessionId);
    expect(state.cwd).toBe("/proj");
    expect(state.phase).toBe("idle");
    expect(state.lastExitCode).toBe(0);
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0].command).toBe("npm test");
  });

  it("caps command history at MAX_COMMAND_HISTORY", () => {
    const store = createStore();
    const sessionId = "term-session-cap";

    for (let index = 0; index < 205; index++) {
      store.set(commandExecutedAtom, {
        sessionId,
        commandLine: `cmd-${index}`,
      });
      store.set(commandFinishedAtom, { sessionId, exitCode: 0 });
    }

    const readSession = store.get(commandDetectionForSessionAtom);
    const state = readSession(sessionId);
    expect(state.commands.length).toBe(200);
    expect(state.commands[0].command).toBe("cmd-5");
    expect(state.commands[199].command).toBe("cmd-204");
  });

  it("removeCommandDetectionAtom drops the session from the map", () => {
    const store = createStore();
    const sessionId = "term-session-rm";

    store.set(commandExecutedAtom, {
      sessionId,
      commandLine: "ls",
    });
    store.set(commandFinishedAtom, { sessionId, exitCode: 0 });
    store.set(removeCommandDetectionAtom, sessionId);

    const map = store.get(commandDetectionMapAtom);
    expect(map.has(sessionId)).toBe(false);
  });
});
