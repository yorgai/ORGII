import {
  CONTAINER_STATE,
  type ContainerSummary,
} from "@src/api/tauri/container";

import { isContainerForRepo } from "../useRepoContainers";

function createContainer(
  overrides: Partial<ContainerSummary> = {}
): ContainerSummary {
  return {
    id: "abcdef1234567890",
    short_id: "abcdef123456",
    names: ["demo-web"],
    display_name: "demo-web",
    image: "nginx:latest",
    image_id: "sha256:test",
    command: null,
    created_at: null,
    state: CONTAINER_STATE.RUNNING,
    status: "Up 1 minute",
    ports: [],
    mounts: [],
    labels: {},
    compose: {},
    ...overrides,
  };
}

describe("isContainerForRepo", () => {
  it("matches compose working directory exactly", () => {
    const container = createContainer({
      compose: {
        project: "demo",
        service: "web",
        working_dir: "/Users/example/demo",
      },
    });

    expect(isContainerForRepo(container, "/Users/example/demo")).toBe(true);
    expect(isContainerForRepo(container, "/Users/example/other")).toBe(false);
  });

  it("matches bind mounts inside the repo", () => {
    const container = createContainer({
      mounts: [
        {
          source: "/Users/example/demo/src",
          destination: "/app/src",
          mode: "rw",
          writable: true,
          mount_type: "bind",
        },
      ],
    });

    expect(isContainerForRepo(container, "/Users/example/demo")).toBe(true);
    expect(isContainerForRepo(container, "/Users/example/dem")).toBe(false);
  });

  it("does not match when repo path is missing", () => {
    expect(isContainerForRepo(createContainer(), undefined)).toBe(false);
  });
});
