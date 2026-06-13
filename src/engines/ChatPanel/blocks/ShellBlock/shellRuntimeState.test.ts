import { describe, expect, it } from "vitest";

import {
  TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS,
  resolveShellRuntimeDisplayState,
} from "./shellRuntimeState";

const NOW_MS = Date.parse("2026-06-13T00:00:00.000Z");

function timestampAgo(ms: number): string {
  return new Date(NOW_MS - ms).toISOString();
}

describe("resolveShellRuntimeDisplayState", () => {
  it("keeps fresh foreground shell loading when active painting is enabled", () => {
    const state = resolveShellRuntimeDisplayState({
      status: "running",
      showActiveEventPainting: true,
      timestamp: timestampAgo(2_000),
      nowMs: NOW_MS,
      shellProcessStatus: "running",
    });

    expect(state.isForegroundRunning).toBe(true);
    expect(state.isLongForegroundWait).toBe(false);
    expect(state.isLoading).toBe(true);
  });

  it("keeps long foreground shell loading even when active painting expired", () => {
    const state = resolveShellRuntimeDisplayState({
      status: "running",
      showActiveEventPainting: false,
      timestamp: timestampAgo(TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS + 1),
      nowMs: NOW_MS,
      shellProcessStatus: "running",
    });

    expect(state.isForegroundRunning).toBe(true);
    expect(state.isLongForegroundWait).toBe(true);
    expect(state.isLoading).toBe(true);
  });

  it("does not keep completed foreground shells loading after exit", () => {
    const state = resolveShellRuntimeDisplayState({
      status: "success",
      showActiveEventPainting: false,
      timestamp: timestampAgo(TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS + 1),
      nowMs: NOW_MS,
      shellProcessStatus: "exited",
      exitCode: 0,
    });

    expect(state.isForegroundRunning).toBe(false);
    expect(state.isLongForegroundWait).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  it("does not treat backgrounded shell processes as foreground waits", () => {
    const state = resolveShellRuntimeDisplayState({
      status: "running",
      showActiveEventPainting: false,
      timestamp: timestampAgo(TERMINAL_FOREGROUND_WAIT_THRESHOLD_MS + 1),
      nowMs: NOW_MS,
      shellProcessStatus: "background",
    });

    expect(state.isForegroundRunning).toBe(false);
    expect(state.isLongForegroundWait).toBe(false);
    expect(state.isLoading).toBe(false);
  });
});
