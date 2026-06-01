import { beforeEach, describe, expect, it, vi } from "vitest";

import { RpcError } from "../invoke";
import { rpc } from "../router";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("typed RPC router", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("calls nested procedures through recursive domains", async () => {
    invokeMock.mockResolvedValue({
      totalSessions: 1,
      totalEvents: 2,
      dbSizeBytes: 3,
    });

    const stats = await rpc.sessionCore.cache.getStats();

    expect(stats).toEqual({
      totalSessions: 1,
      totalEvents: 2,
      dbSizeBytes: 3,
    });
    expect(invokeMock).toHaveBeenCalledWith("cache_get_stats", {});
  });

  it("validates nested procedure input before invoking Tauri", async () => {
    await expect(
      rpc.sessionCore.cache.loadEvents({
        sessionId: 123 as unknown as string,
      })
    ).rejects.toBeInstanceOf(RpcError);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("accepts effective tools output with omitted serde-default fields", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error");
    invokeMock.mockResolvedValue({
      sessionId: "sde-test",
      agentExecMode: "plan",
      registeredToolNames: ["read_file", "create_plan"],
      promptToolNames: ["read_file"],
      deferredToolNames: ["db_explore"],
      promptTools: [
        {
          name: "read_file",
          description: "Read files",
          category: "filesystem",
        },
        {
          name: "create_plan",
          description: "Create plan",
          category: "planning",
          source: "builtin",
          supported_agents: ["sde"],
          icon_id: "list-checks",
          actionIcons: { create: "plus" },
          statusIcons: { approved: "check" },
          simulatorApp: "CHANNELS",
          appSubtool: "message",
          chatBlock: "plan_doc",
          humanToolKey: null,
          hidden: false,
          labelRunning: "sessions:tools.createPlan.running",
          labelDone: "sessions:tools.createPlan.done",
          labelFailed: "sessions:tools.createPlan.failed",
          statusLabels: { approved: "sessions:tools.createPlan.approved" },
          actions: [
            {
              name: "create",
              summary: "Create a plan",
              appSubtool: "message",
              chatBlock: "plan_doc",
              labelRunning: "sessions:tools.createPlan.running",
              labelDone: "sessions:tools.createPlan.done",
              labelFailed: "sessions:tools.createPlan.failed",
              statusLabels: { approved: "sessions:tools.createPlan.approved" },
            },
          ],
          requiredCapability: "coding",
        },
      ],
    });

    const result = await rpc.tools.listEffectiveToolsForSession({
      request: { sessionId: "sde-test", agentExecMode: "plan" },
    });

    expect(result.promptToolNames).toEqual(["read_file"]);
    expect(invokeMock).toHaveBeenCalledWith(
      "agent_list_effective_tools_for_session",
      {
        request: { sessionId: "sde-test", agentExecMode: "plan" },
      }
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("reports nested procedure output validation failures in development", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error");
    invokeMock.mockResolvedValue({ totalSessions: "bad" });

    await rpc.sessionCore.cache.getStats();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[RPC:cache_get_stats] Output validation failed",
      expect.any(Array),
      "Raw:",
      { totalSessions: "bad" }
    );
  });
});
