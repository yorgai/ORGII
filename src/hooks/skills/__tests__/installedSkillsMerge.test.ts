import { describe, expect, it } from "vitest";

import type { InstalledSkill } from "@src/types/extensions";

import { mergeInstalledSkills } from "../installedSkillsMerge";

function createSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    name: "skill",
    path: "/global/.orgii/skills/skill",
    source: "global",
    always: false,
    available: true,
    enabled: true,
    requiredBins: [],
    requiredEnv: [],
    description: "",
    estimatedTokens: 0,
    fullContentTokens: 0,
    ...overrides,
  } as InstalledSkill;
}

describe("mergeInstalledSkills", () => {
  it("returns an empty list when given no lists", () => {
    expect(mergeInstalledSkills([])).toEqual([]);
  });

  it("returns an empty list when all lists are empty", () => {
    expect(mergeInstalledSkills([[], []])).toEqual([]);
  });

  it("unions skills from multiple scopes", () => {
    const global = createSkill({ name: "a", path: "/g/a", source: "global" });
    const workspace = createSkill({
      name: "b",
      path: "/repo/.orgii/skills/b",
      source: "external-source",
    });

    const merged = mergeInstalledSkills([[global], [workspace]]);

    expect(merged).toHaveLength(2);
    expect(merged.map((s) => s.path)).toEqual([
      "/g/a",
      "/repo/.orgii/skills/b",
    ]);
  });

  it("de-duplicates by path, keeping the first occurrence (global wins)", () => {
    const globalCopy = createSkill({
      name: "dup",
      path: "/shared/dup",
      source: "global",
      enabled: true,
    });
    const workspaceCopy = createSkill({
      name: "dup",
      path: "/shared/dup",
      source: "external-source",
      enabled: false,
    });

    const merged = mergeInstalledSkills([[globalCopy], [workspaceCopy]]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("global");
    expect(merged[0].enabled).toBe(true);
  });

  it("keeps skills with the same name but different paths as distinct", () => {
    const repoA = createSkill({
      name: "review",
      path: "/repoA/.orgii/skills/review",
    });
    const repoB = createSkill({
      name: "review",
      path: "/repoB/.orgii/skills/review",
    });

    const merged = mergeInstalledSkills([[repoA], [repoB]]);

    expect(merged).toHaveLength(2);
  });

  it("de-duplicates within a single list too", () => {
    const skill = createSkill({ path: "/g/x" });
    const merged = mergeInstalledSkills([[skill, { ...skill }]]);
    expect(merged).toHaveLength(1);
  });

  it("treats a skill directory and its SKILL.md file as the same location", () => {
    const directoryForm = createSkill({
      name: "e2e-testing",
      path: "/repo/.orgii/skills/e2e-testing/",
    });
    const fileForm = createSkill({
      name: "e2e-testing",
      path: "/repo/.orgii/skills/e2e-testing/SKILL.md",
    });

    const merged = mergeInstalledSkills([[directoryForm], [fileForm]]);

    expect(merged).toHaveLength(1);
    expect(merged[0].path).toBe(directoryForm.path);
  });
});
