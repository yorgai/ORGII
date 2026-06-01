/**
 * Command Detection Atoms
 *
 * Per-session state populated by the ShellIntegrationAddon when
 * OSC 633 sequences arrive from the shell.
 */
import { atom } from "jotai";

// ============================================
// Types
// ============================================

export type CommandPhase = "idle" | "prompt" | "input" | "running";

export interface CommandEntry {
  command: string;
  exitCode: number;
  startedAt: number;
  finishedAt: number;
}

export interface CommandDetectionState {
  phase: CommandPhase;
  cwd: string | null;
  currentCommand: string | null;
  lastExitCode: number | null;
  commands: CommandEntry[];
}

const MAX_COMMAND_HISTORY = 200;

function emptyState(): CommandDetectionState {
  return {
    phase: "idle",
    cwd: null,
    currentCommand: null,
    lastExitCode: null,
    commands: [],
  };
}

// ============================================
// Core Atom  (Map<sessionId, state>)
// ============================================

export const commandDetectionMapAtom = atom<Map<string, CommandDetectionState>>(
  new Map()
);

// ============================================
// Derived: single-session read
// ============================================

export const commandDetectionForSessionAtom = atom((get) => {
  const map = get(commandDetectionMapAtom);
  return (sessionId: string): CommandDetectionState =>
    map.get(sessionId) ?? emptyState();
});

// ============================================
// Action Atoms
// ============================================

export const commandPromptStartAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const map = new Map(get(commandDetectionMapAtom));
    const prev = map.get(sessionId) ?? emptyState();
    map.set(sessionId, {
      ...prev,
      phase: "prompt",
      currentCommand: null,
    });
    set(commandDetectionMapAtom, map);
  }
);

export const commandExecutedAtom = atom(
  null,
  (
    get,
    set,
    payload: { sessionId: string; commandLine: string | undefined }
  ) => {
    const map = new Map(get(commandDetectionMapAtom));
    const prev = map.get(payload.sessionId) ?? emptyState();
    map.set(payload.sessionId, {
      ...prev,
      phase: "running",
      currentCommand: payload.commandLine ?? prev.currentCommand,
    });
    set(commandDetectionMapAtom, map);
  }
);

export const commandFinishedAtom = atom(
  null,
  (get, set, payload: { sessionId: string; exitCode: number }) => {
    const map = new Map(get(commandDetectionMapAtom));
    const prev = map.get(payload.sessionId) ?? emptyState();
    const now = Date.now();

    const entry: CommandEntry | null = prev.currentCommand
      ? {
          command: prev.currentCommand,
          exitCode: payload.exitCode,
          startedAt: now,
          finishedAt: now,
        }
      : null;

    let commands = prev.commands;
    if (entry) {
      commands = [...commands, entry];
      if (commands.length > MAX_COMMAND_HISTORY) {
        commands = commands.slice(commands.length - MAX_COMMAND_HISTORY);
      }
    }

    map.set(payload.sessionId, {
      ...prev,
      phase: "idle",
      currentCommand: null,
      lastExitCode: payload.exitCode,
      commands,
    });
    set(commandDetectionMapAtom, map);
  }
);

export const commandCwdChangedAtom = atom(
  null,
  (get, set, payload: { sessionId: string; cwd: string }) => {
    const map = new Map(get(commandDetectionMapAtom));
    const prev = map.get(payload.sessionId) ?? emptyState();
    map.set(payload.sessionId, { ...prev, cwd: payload.cwd });
    set(commandDetectionMapAtom, map);
  }
);

export const removeCommandDetectionAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const map = new Map(get(commandDetectionMapAtom));
    map.delete(sessionId);
    set(commandDetectionMapAtom, map);
  }
);
