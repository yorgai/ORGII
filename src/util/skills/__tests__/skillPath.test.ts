import { describe, expect, it } from "vitest";

import { extractSkillNameFromPath } from "../skillPath";

describe("extractSkillNameFromPath", () => {
  it("matches workspace skills (.orgii/skills/<name>/SKILL.md)", () => {
    expect(
      extractSkillNameFromPath("/repo/.orgii/skills/code-review/SKILL.md")
    ).toBe("code-review");
  });

  it("matches global user skills (~/.orgii/skills/<name>/SKILL.md)", () => {
    expect(
      extractSkillNameFromPath(
        "/Users/dev/.orgii/skills/frontend-ui-audit/SKILL.md"
      )
    ).toBe("frontend-ui-audit");
  });

  it("matches Cursor user skills (~/.cursor/skills/<name>/SKILL.md)", () => {
    expect(
      extractSkillNameFromPath(
        "/Users/dev/.cursor/skills/brainstorming/SKILL.md"
      )
    ).toBe("brainstorming");
  });

  it("matches Cursor builtin skills (~/.cursor/skills-cursor/<name>/SKILL.md)", () => {
    expect(
      extractSkillNameFromPath(
        "/Users/dev/.cursor/skills-cursor/code-review/SKILL.md"
      )
    ).toBe("code-review");
  });

  it("matches Windows-style backslash paths", () => {
    expect(
      extractSkillNameFromPath("C:\\repo\\.orgii\\skills\\loop\\SKILL.md")
    ).toBe("loop");
  });

  it("is case-insensitive on SKILL.md", () => {
    expect(extractSkillNameFromPath("/repo/.orgii/skills/sdk/skill.md")).toBe(
      "sdk"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(
      extractSkillNameFromPath("  /repo/.orgii/skills/shell/SKILL.md\n")
    ).toBe("shell");
  });

  it("returns null for non-skill paths", () => {
    expect(extractSkillNameFromPath("/repo/src/index.ts")).toBeNull();
    expect(extractSkillNameFromPath("/repo/skills/README.md")).toBeNull();
    expect(extractSkillNameFromPath("/repo/.orgii/skills/SKILL.md")).toBeNull();
  });

  it("returns null on empty / nullish input", () => {
    expect(extractSkillNameFromPath("")).toBeNull();
  });
});
