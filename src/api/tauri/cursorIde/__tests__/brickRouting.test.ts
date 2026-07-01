import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  brickHistorySessions: vi.fn(),
  brickHistoryChunks: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@src/api/tauri/brickHistory", () => ({
  brickHistorySessions: mocks.brickHistorySessions,
  brickHistoryChunks: mocks.brickHistoryChunks,
}));

vi.mock("@src/hooks/logger", () => ({
  createLogger: () => ({
    warn: mocks.warn,
  }),
}));

describe("Cursor IDE Brick routing", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.brickHistorySessions.mockReset();
    mocks.brickHistoryChunks.mockReset();
    mocks.warn.mockReset();
  });

  it("lists Cursor IDE sessions through Brick first", async () => {
    const { cursorIdeListSessions } = await import("../index");
    mocks.brickHistorySessions.mockResolvedValue({
      sessions: [
        {
          sessionId: "cursoride-1",
          name: "Cursor chat",
          status: "completed",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          category: "cursor_ide",
          readOnly: true,
          totalTokens: 10,
          linesAdded: 1,
          linesRemoved: 2,
          filesChanged: 3,
          touchedFiles: ["src/main.ts"],
          background: false,
          isActive: false,
        },
      ],
      hasMore: false,
    });

    const page = await cursorIdeListSessions({ limit: 25, offset: 50 });

    expect(mocks.brickHistorySessions).toHaveBeenCalledWith({
      sourceId: "cursor_ide",
      limit: 25,
      offset: 50,
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(page.sessions[0]).toMatchObject({
      sessionId: "cursoride-1",
      category: "cursor_ide",
      readOnly: true,
    });
  });

  it("propagates Brick list failures instead of falling back", async () => {
    const { cursorIdeListSessions } = await import("../index");
    const error = new Error("brick unavailable");
    mocks.brickHistorySessions.mockRejectedValue(error);

    await expect(cursorIdeListSessions({ limit: 10 })).rejects.toBe(error);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("loads historical chunks through Brick", async () => {
    const { cursorIdeChunks } = await import("../index");
    const chunks = [
      {
        chunk_id: "chunk-1",
        action_type: "assistant",
        function: "cursor",
        args: {},
        result: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    mocks.brickHistoryChunks.mockResolvedValue(chunks);

    await expect(cursorIdeChunks("cursoride-1")).resolves.toBe(chunks);
    expect(mocks.brickHistoryChunks).toHaveBeenCalledWith({
      sourceId: "cursor_ide",
      sessionId: "cursoride-1",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps live full refresh on the legacy Cursor command", async () => {
    const { cursorIdeLiveFullRefresh } = await import("../index");
    mocks.invoke.mockResolvedValue({ chunks: [], turns: [] });

    await expect(cursorIdeLiveFullRefresh("cursoride-1")).resolves.toEqual({
      chunks: [],
      turns: [],
    });

    expect(mocks.invoke).toHaveBeenCalledWith("cursor_ide_full_refresh", {
      sessionId: "cursoride-1",
    });
    expect(mocks.brickHistoryChunks).not.toHaveBeenCalled();
  });
});
