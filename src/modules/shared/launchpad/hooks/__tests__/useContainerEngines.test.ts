import {
  CONTAINER_ENGINE_KIND,
  type ContainerEngineCandidate,
} from "@src/api/tauri/container";

import { filterRemoteContainerEngines } from "../useContainerEngines";

function createEngine(
  overrides: Partial<ContainerEngineCandidate>
): ContainerEngineCandidate {
  return {
    id: "engine",
    kind: CONTAINER_ENGINE_KIND.LOCAL,
    label: "engine",
    current: false,
    available: true,
    endpoint: null,
    detail: null,
    ...overrides,
  };
}

describe("filterRemoteContainerEngines", () => {
  it("filters out local Docker contexts", () => {
    const engines = [
      createEngine({
        id: "default",
        label: "default",
        kind: CONTAINER_ENGINE_KIND.LOCAL,
      }),
      createEngine({
        id: "desktop-linux",
        label: "desktop-linux",
        kind: CONTAINER_ENGINE_KIND.LOCAL,
      }),
      createEngine({
        id: "prod-ssh",
        label: "prod-ssh",
        kind: CONTAINER_ENGINE_KIND.SSH,
      }),
    ];

    expect(
      filterRemoteContainerEngines(engines).map((engine) => engine.id)
    ).toEqual(["prod-ssh"]);
  });

  it("keeps SSH and WSL Docker contexts", () => {
    const engines = [
      createEngine({
        id: "prod-ssh",
        label: "prod-ssh",
        kind: CONTAINER_ENGINE_KIND.SSH,
      }),
      createEngine({
        id: "ubuntu-wsl",
        label: "ubuntu-wsl",
        kind: CONTAINER_ENGINE_KIND.WSL,
      }),
    ];

    expect(filterRemoteContainerEngines(engines)).toHaveLength(2);
  });
});
