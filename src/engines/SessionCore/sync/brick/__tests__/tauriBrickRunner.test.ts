import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTauriBrickRunner } from "../tauriBrickRunner";

const { executeMock, createMock } = vi.hoisted(() => {
  const executeMock = vi.fn();
  const createMock = vi.fn(() => ({ execute: executeMock }));
  return { executeMock, createMock };
});

vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: { create: createMock },
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("createTauriBrickRunner", () => {
  beforeEach(() => {
    executeMock.mockReset();
    createMock.mockClear();
  });

  it("passes brick args as positional params, never interpolated", async () => {
    executeMock.mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const run = createTauriBrickRunner("brick");
    await run(["history", "sessions", "--source", "claude_code"], {
      timeoutMs: 1000,
    });
    expect(createMock).toHaveBeenCalledWith("sh", [
      "-c",
      'exec "$0" "$@"',
      "brick",
      "history",
      "sessions",
      "--source",
      "claude_code",
    ]);
  });

  it("returns parsed result on success", async () => {
    executeMock.mockResolvedValue({
      code: 0,
      stdout: '{"ok":true}',
      stderr: "",
    });
    const run = createTauriBrickRunner();
    const result = await run(["version"], { timeoutMs: 1000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"ok":true}');
    expect(result.timedOut).toBe(false);
  });

  it("reports timeout when execution exceeds the budget", async () => {
    executeMock.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    const run = createTauriBrickRunner();
    const result = await run(["version"], { timeoutMs: 10 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("captures spawn failure as a non-throwing result", async () => {
    executeMock.mockRejectedValue(new Error("not found"));
    const run = createTauriBrickRunner();
    const result = await run(["version"], { timeoutMs: 1000 });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("not found");
    expect(result.timedOut).toBe(false);
  });
});
