import { createStore } from "jotai/vanilla";

import type { Project } from "@src/types/core/project";

import {
  filteredProjectsAtom,
  hasProjectsAtom,
  projectCountAtom,
  projectFilterAtom,
  projectMapAtom,
  projectSearchAtom,
  projectStatsAtom,
  projectsAtom,
  projectsByStatusAtom,
  selectedProjectAtom,
  selectedProjectIdAtom,
} from "../projectAtom";

function makeProject(
  overrides: Partial<Project> & Pick<Project, "id" | "name">
): Project {
  return {
    status: "backlog",
    priority: "medium",
    health: "on_track",
    createdAt: "2025-01-01",
    updatedAt: "2025-01-01",
    ...overrides,
  };
}

describe("projectAtom derived atoms", () => {
  it("resolves selectedProjectAtom from id", () => {
    const store = createStore();
    const alpha = makeProject({ id: "p1", name: "Alpha" });
    store.set(projectsAtom, [alpha]);
    store.set(selectedProjectIdAtom, "p1");
    expect(store.get(selectedProjectAtom)).toEqual(alpha);
    store.set(selectedProjectIdAtom, "missing");
    expect(store.get(selectedProjectAtom)).toBeNull();
  });

  it("filters by search across name and description", () => {
    const store = createStore();
    store.set(projectsAtom, [
      makeProject({ id: "a", name: "Auth Service", description: "login" }),
      makeProject({ id: "b", name: "Billing", description: "payments" }),
    ]);
    store.set(projectSearchAtom, "bill");
    expect(
      store.get(filteredProjectsAtom).map((project) => project.id)
    ).toEqual(["b"]);
  });

  it("applies status, priority, health, and lead filters together", () => {
    const store = createStore();
    const leadId = "user-1";
    store.set(projectsAtom, [
      makeProject({
        id: "ok",
        name: "X",
        status: "in_progress",
        priority: "high",
        health: "at_risk",
        lead: { id: leadId, name: "Lead" },
      }),
      makeProject({
        id: "wrong-status",
        name: "Y",
        status: "completed",
        priority: "high",
        health: "at_risk",
        lead: { id: leadId, name: "Lead" },
      }),
    ]);
    store.set(projectFilterAtom, {
      status: ["in_progress"],
      priority: ["high"],
      health: ["at_risk"],
      leadId,
    });
    expect(
      store.get(filteredProjectsAtom).map((project) => project.id)
    ).toEqual(["ok"]);
  });

  it("groups filtered projects by status with empty buckets", () => {
    const store = createStore();
    store.set(projectsAtom, [
      makeProject({ id: "a", name: "A", status: "backlog" }),
      makeProject({ id: "b", name: "B", status: "backlog" }),
      makeProject({ id: "c", name: "C", status: "completed" }),
    ]);
    store.set(projectSearchAtom, "");
    const grouped = store.get(projectsByStatusAtom);
    expect(grouped.get("backlog")).toHaveLength(2);
    expect(grouped.get("completed")).toHaveLength(1);
    expect(grouped.get("planned")).toEqual([]);
  });

  it("exposes count and hasProjects", () => {
    const store = createStore();
    expect(store.get(projectCountAtom)).toBe(0);
    expect(store.get(hasProjectsAtom)).toBe(false);
    store.set(projectsAtom, [makeProject({ id: "only", name: "Only" })]);
    expect(store.get(projectCountAtom)).toBe(1);
    expect(store.get(hasProjectsAtom)).toBe(true);
  });

  it("computes projectStatsAtom aggregates", () => {
    const store = createStore();
    store.set(projectsAtom, [
      makeProject({
        id: "a",
        name: "A",
        status: "completed",
        health: "on_track",
        workItemCount: 3,
      }),
      makeProject({
        id: "b",
        name: "B",
        status: "backlog",
        health: "at_risk",
        workItemCount: 2,
      }),
    ]);
    const stats = store.get(projectStatsAtom);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.completed).toBe(1);
    expect(stats.byStatus.backlog).toBe(1);
    expect(stats.byHealth.on_track).toBe(1);
    expect(stats.byHealth.at_risk).toBe(1);
    expect(stats.totalWorkItems).toBe(5);
    expect(stats.completionRate).toBe(50);
  });

  it("builds projectMapAtom for id lookup", () => {
    const store = createStore();
    const project = makeProject({ id: "map-1", name: "Mapped" });
    store.set(projectsAtom, [project]);
    expect(store.get(projectMapAtom).get("map-1")).toEqual(project);
  });
});
