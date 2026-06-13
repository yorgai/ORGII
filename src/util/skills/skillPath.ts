/**
 * Match skill file paths of the form:
 *   …/skills/<name>/SKILL.md
 *   …/skills-cursor/<name>/SKILL.md   (Cursor's per-user skills directory)
 *
 * Returns the skill directory name (second-to-last path segment) or null.
 *
 * Canonical skill-store locations covered:
 *   `<workspace>/.orgii/skills/<name>/SKILL.md`  (workspace)
 *   `~/.orgii/skills/<name>/SKILL.md`            (global / per-user)
 *   `~/.cursor/skills/<name>/SKILL.md`           (Cursor user skills)
 *   `~/.cursor/skills-cursor/<name>/SKILL.md`    (Cursor builtins)
 */
const SKILL_PATH_RE = /[/\\]skills(?:-[^/\\]+)?[/\\]([^/\\]+)[/\\]SKILL\.md$/i;

export function extractSkillNameFromPath(text: string): string | null {
  if (!text) return null;
  const match = text.trim().match(SKILL_PATH_RE);
  return match ? match[1] : null;
}
