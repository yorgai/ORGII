import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type LinearProjectUpdateRequest,
  linearProjectsApi,
} from "../linearProjects";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("linearProjectsApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("passes explicit null project update fields through to Tauri", async () => {
    invokeMock.mockResolvedValue({
      id: "project-1",
      name: "Roadmap",
      teams: [],
    });

    const request: LinearProjectUpdateRequest = {
      description: null,
      lead_id: null,
      start_date: null,
      target_date: null,
    };

    await linearProjectsApi.updateProject("connection-1", "project-1", request);

    expect(invokeMock).toHaveBeenCalledWith("linear_project_update", {
      connectionId: "connection-1",
      projectId: "project-1",
      request: {
        description: null,
        lead_id: null,
        start_date: null,
        target_date: null,
      },
    });
  });
});
