/** Stats block from ClawHub skill detail. */
export interface HubSkillStats {
  comments: number;
  downloads: number;
  installsAllTime: number;
  installsCurrent: number;
  stars: number;
  versions: number;
}

/** Owner info from ClawHub skill detail. */
export interface HubSkillOwner {
  handle: string;
  displayName?: string;
  image?: string;
}

/** Full skill detail from ClawHub `/api/v1/skills/{slug}`. */
export interface HubSkillDetail {
  slug: string;
  name: string;
  description: string;
  version: string;
  stats?: HubSkillStats;
  owner?: HubSkillOwner;
  createdAt?: number;
  updatedAt?: number;
  changelog?: string;
  skillMd?: string;
}

/** Result of installing a skill from ClawHub. */
export interface HubInstallResult {
  name: string;
  path: string;
}

/** Info about a skill with an available update on ClawHub. */
export interface SkillUpdateInfo {
  name: string;
  slug: string;
  installedVersion: string;
  latestVersion: string;
  changelog?: string;
}

/** Quality rating for a skill's description.
 *
 * Mirrors Rust `DescriptionQuality` in
 * `src-tauri/src/agent_core/intelligence/skills/loader/types.rs`. */
export const DESCRIPTION_QUALITY = {
  GOOD: "good",
  SHORT: "short",
  MISSING: "missing",
} as const;
export type DescriptionQuality =
  (typeof DESCRIPTION_QUALITY)[keyof typeof DESCRIPTION_QUALITY];

/** Where a skill came from. Mirrors the Rust `&'static str` value
 * threaded through `SkillsLoader::scan_skills_dir` (`scanner.rs`).
 *
 * - `WORKSPACE`        — `<workspace>/.orgii/skills/<name>/`
 * - `BUILTIN`          — `~/.orgii/skills/<name>/` (per-user, default)
 * - `EMBEDDED_BUILTIN` — binary-embedded skills that ship with ORGII */
export const SKILL_SOURCE = {
  WORKSPACE: "workspace",
  BUILTIN: "builtin",
  EMBEDDED_BUILTIN: "embedded_builtin",
} as const;
export type SkillSource = (typeof SKILL_SOURCE)[keyof typeof SKILL_SOURCE];

/** Where a skill is saved when authored from the editor. */
export const SKILL_SCOPE = {
  GLOBAL: "global",
  WORKSPACE: "workspace",
} as const;
export type SkillScope = (typeof SKILL_SCOPE)[keyof typeof SKILL_SCOPE];

/** Default token budget for the skills section (must match Rust DEFAULT_SKILLS_TOKEN_BUDGET). */
export const SKILLS_TOKEN_BUDGET = 4000;

/** A locally installed skill (from skills_list Tauri command). */
export interface InstalledSkill {
  name: string;
  path: string;
  source: string;
  always: boolean;
  /** Whether all required binaries/env vars are present. */
  available: boolean;
  /** Whether the user has this skill enabled (not in disabledSkills). */
  enabled: boolean;
  requiredBins: string[];
  requiredEnv: string[];
  description: string;
  /** Estimated token cost in the system prompt. */
  estimatedTokens: number;
  /** Estimated tokens for the full SKILL.md content. */
  fullContentTokens: number;
  /** Quality of the description for agent discovery. */
  descriptionQuality: DescriptionQuality;
  /** Skill version from frontmatter (empty if not specified). */
  version: string;
  /** License from frontmatter (empty if not specified). */
  license: string;
  /** Compatibility notes from frontmatter (empty if not specified). */
  compatibility: string;
  /** Which required binaries are not found on PATH. */
  missingBins: string[];
  /** Which required env vars are not set. */
  missingEnv: string[];
  /** Relative paths of bundled files (scripts, references, assets). */
  bundledFiles: string[];
}

/** Category for a unified slash menu item. */
export type SlashItemCategory = "skill" | "action" | "tool";

/** Unified slash menu item shown in the `/` dropdown. */
export interface SlashItem {
  name: string;
  description: string;
  category: SlashItemCategory;
  source: string;
  acceptsArgs: boolean;
  /** For tool items: the MCP server name this tool belongs to. */
  serverName?: string;
  /**
   * For skill items: the skill's name as known to the backend (used as
   * the slash-command token, e.g. `/statusline`). Distinct from `name`
   * which is the human-readable display label.
   */
  skillName?: string;
}

/** Built-in slash action names. */
export const SLASH_ACTIONS = {
  SUMMARIZE: "Summarize",
  OPEN_BROWSER: "Open Browser",
  SETUP_REPO: "Setup Repo",
} as const;
