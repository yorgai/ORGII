/**
 * Prettify an agent-org member identifier for display.
 *
 * Member IDs are stored as kebab-case slugs such as `sde-reviewer` or
 * `os-builder`. The UI should render them with the leading domain acronym
 * uppercased and the remainder lowercased, separated by spaces, e.g.
 * `sde-reviewer` → `SDE reviewer`, `cli-agent-runner` → `CLI agent runner`.
 *
 * Single-word ids (no separator) are capitalized only if they are not already
 * mixed case — `Planner` is left untouched, `planner` becomes `Planner`.
 * Untouchable: an empty / whitespace-only value falls back to "?".
 */

const ACRONYMS = new Set([
  "sde",
  "os",
  "ai",
  "ml",
  "qa",
  "ux",
  "ui",
  "api",
  "cli",
  "sdk",
  "llm",
  "ci",
  "cd",
  "vp",
  "pr",
  "pm",
  "io",
  "db",
  "url",
  "uri",
  "json",
  "yaml",
  "sql",
  "ide",
  "id",
]);

function formatToken(token: string, isFirst: boolean): string {
  const lower = token.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  if (isFirst) return lower.charAt(0).toUpperCase() + lower.slice(1);
  return lower;
}

export function prettifyMemberName(rawId: string | null | undefined): string {
  const trimmed = (rawId ?? "").trim();
  if (!trimmed) return "";
  if (!/[-_]/.test(trimmed)) {
    if (trimmed !== trimmed.toLowerCase()) return trimmed;
    return formatToken(trimmed, true);
  }
  const tokens = trimmed.split(/[-_]+/).filter(Boolean);
  return tokens
    .map((token, index) => formatToken(token, index === 0))
    .join(" ");
}
