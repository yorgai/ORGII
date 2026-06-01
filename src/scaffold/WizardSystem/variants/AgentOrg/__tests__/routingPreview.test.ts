import type { OrgMember } from "@src/modules/MainApp/AgentOrgs/types";

import {
  buildPreviewGraph,
  decideRouting,
  findIsolatedMemberIds,
} from "../routingPreview";

/**
 * Two-branch fixture mirroring `routing_ctx` in
 * `agent_org_runs::tests`. Keep the topology in sync — the parity
 * tests at the bottom of this file pin every Strict allow / block
 * decision the Rust suite covers.
 *
 *     coord
 *     ├── lead-a
 *     │     └── ic-a
 *     └── lead-b
 *           └── ic-b
 */
function buildOrg(): OrgMember {
  return {
    id: "coord",
    name: "RoutingOrg",
    role: "lead",
    agentId: "agent-coord",
    children: [
      {
        id: "member-a",
        name: "lead-a",
        role: "lead",
        agentId: "agent-a",
        children: [
          {
            id: "member-a-ic",
            name: "ic-a",
            role: "ic",
            agentId: "agent-a-ic",
            children: [],
          },
        ],
      },
      {
        id: "member-b",
        name: "lead-b",
        role: "lead",
        agentId: "agent-b",
        children: [
          {
            id: "member-b-ic",
            name: "ic-b",
            role: "ic",
            agentId: "agent-b-ic",
            children: [],
          },
        ],
      },
    ],
  };
}

describe("buildPreviewGraph", () => {
  it("flattens the tree depth-first with the coordinator as root", () => {
    const graph = buildPreviewGraph(buildOrg(), "soft");
    expect(graph.coordinatorId).toBe("coord");
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "coord",
      "member-a",
      "member-a-ic",
      "member-b",
      "member-b-ic",
    ]);
  });

  it("populates parentId pointing at the immediate manager", () => {
    const graph = buildPreviewGraph(buildOrg(), "soft");
    const ic = graph.nodes.find((node) => node.id === "member-a-ic");
    expect(ic?.parentId).toBe("member-a");
    const lead = graph.nodes.find((node) => node.id === "member-a");
    expect(lead?.parentId).toBe("coord");
  });

  it("falls back to root.hierarchyMode then 'soft'", () => {
    const root = { ...buildOrg(), hierarchyMode: "strict" as const };
    expect(buildPreviewGraph(root).hierarchyMode).toBe("strict");
    expect(buildPreviewGraph(buildOrg()).hierarchyMode).toBe("soft");
  });
});

describe("decideRouting (parity with Rust check_routing)", () => {
  it("Flat allows everything", () => {
    const graph = buildPreviewGraph(buildOrg(), "flat");
    expect(decideRouting(graph, "member-a-ic", "member-b-ic")).toBe("allowed");
    expect(decideRouting(graph, "member-b", "member-a")).toBe("allowed");
  });

  it("Soft allows everything (advisory only at runtime)", () => {
    const graph = buildPreviewGraph(buildOrg(), "soft");
    expect(decideRouting(graph, "member-a-ic", "member-b-ic")).toBe("allowed");
  });

  it("Strict allows anyone → coordinator", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a-ic", "coord")).toBe("allowed");
  });

  it("Strict allows coordinator → anyone (escape hatch)", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "coord", "member-b-ic")).toBe("allowed");
  });

  it("Strict allows send to direct manager", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a-ic", "member-a")).toBe("allowed");
  });

  it("Strict allows send to direct report", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a", "member-a-ic")).toBe("allowed");
  });

  it("Strict blocks cross-branch", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a-ic", "member-b-ic")).toBe("blocked");
  });

  it("Strict blocks skip-level-up", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a-ic", "member-b")).toBe("blocked");
  });

  it("Strict blocks peer-to-peer leads", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a", "member-b")).toBe("blocked");
  });

  it("self routing is always blocked", () => {
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(decideRouting(graph, "member-a", "member-a")).toBe("blocked");
  });
});

describe("findIsolatedMemberIds", () => {
  it("returns [] under Flat", () => {
    const graph = buildPreviewGraph(buildOrg(), "flat");
    expect(findIsolatedMemberIds(graph)).toEqual([]);
  });

  it("returns [] under Soft", () => {
    const graph = buildPreviewGraph(buildOrg(), "soft");
    expect(findIsolatedMemberIds(graph)).toEqual([]);
  });

  it("flags an IC whose only non-coordinator peer is its lead — wait, that one is not isolated", () => {
    // ic-a can reach lead-a, so it is NOT isolated. The fixture has
    // no isolated members; this test pins that the fixture is
    // healthy and the next test exercises the isolated case via
    // a custom graph.
    const graph = buildPreviewGraph(buildOrg(), "strict");
    expect(findIsolatedMemberIds(graph)).toEqual([]);
  });

  it("flags a top-level lead with no children and no peers", () => {
    // Single lone lead under the coordinator: only "allowed" peer
    // is the coordinator, so it counts as isolated for collaboration
    // purposes.
    const lonely: OrgMember = {
      id: "coord",
      name: "Lonely",
      role: "lead",
      agentId: "agent-coord",
      children: [
        {
          id: "loner",
          name: "Solo",
          role: "ic",
          agentId: "agent-loner",
          children: [],
        },
      ],
    };
    const graph = buildPreviewGraph(lonely, "strict");
    expect(findIsolatedMemberIds(graph)).toEqual(["loner"]);
  });
});
