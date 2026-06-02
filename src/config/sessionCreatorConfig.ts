/**
 * Session Creator — shared config
 *
 * Types and config arrays shared between SessionCreator (features/)
 * and ChatPanel (engines/). Moved from features/SessionCreator/config.ts
 * to break the cross-feature dependency.
 */
import {
  Infinity,
  Cloud,
  GitBranchPlus,
  Laptop,
  ListTodo,
  Search,
} from "lucide-react";

// ============================================
// Session Configuration
// ============================================

export const SESSION_CONFIG = {
  MAX_SESSION_NAME_LENGTH: 50,
  DEFAULT_SESSION_NAME: "New Session",
  MAX_REPOS: 3,
  INPUT_WIDTH: 550,
  BASE_FONT_SIZE: 20,
  MIN_FONT_SIZE: 14,
  MAX_FONT_SIZE: 20,
  MIN_UNDERLINE_WIDTH: 140,
  MAX_UNDERLINE_WIDTH: 570,
  EDITOR_HEIGHT: 300,
  EDITOR_MAX_WIDTH: 650,
  EDITOR_MIN_HEIGHT: 100,
} as const;

// ============================================
// Agent exec mode (Rust `AgentExecMode`)
// ============================================
//
// User-selectable picker shows the three entries in `AGENT_EXEC_MODES`:
//   build / plan / investigate (surfaced as "Ask").
// `debug`, `review`, and `wingman` remain valid wire values but are hidden
// from the picker (`debug` was removed from the UI on 2026-06-02; `review`
// drives background work-item review flows; `wingman` is the passive
// observer mode). Legacy `ask` / `explore` values in localStorage are
// migrated to `investigate` at load time (see `creatorDefaultExecModeAtom`).

export type AgentExecMode =
  | "build"
  | "investigate"
  | "plan"
  | "debug"
  | "review"
  | "wingman";

export const DEFAULT_AGENT_EXEC_MODE: AgentExecMode = "build";

/**
 * Every valid `AgentExecMode` wire value the Rust backend can emit.
 *
 * Use this — NOT `AGENT_EXEC_MODES.map(m => m.id)` — when validating an
 * incoming exec mode from Rust (WS events, session records, persisted
 * settings). `AGENT_EXEC_MODES` is the *picker* list (build/investigate/
 * plan/debug only). The full union also includes `review` (internal flows)
 * and `wingman` (passive-observer mode). Validating against the picker
 * list silently coerced wingman/review sessions to `"build"`, which
 * re-enabled write tools on a read-only / passive session — the exact
 * footgun the Rust `AgentExecMode::parse` comment warns about.
 */
export const ALL_AGENT_EXEC_MODES: ReadonlySet<AgentExecMode> =
  new Set<AgentExecMode>([
    "build",
    "investigate",
    "plan",
    "debug",
    "review",
    "wingman",
  ]);

export function isAgentExecMode(value: unknown): value is AgentExecMode {
  return (
    typeof value === "string" &&
    (ALL_AGENT_EXEC_MODES as ReadonlySet<string>).has(value)
  );
}

export interface AgentExecModeEntry {
  id: AgentExecMode;
  icon: typeof Infinity;
  i18nKey: string;
  name: string;
  description: string;
}

export const AGENT_EXEC_MODES: AgentExecModeEntry[] = [
  {
    id: "build",
    icon: Infinity,
    i18nKey: "planner.modes.build",
    name: "Build",
    description: "Full tool access — read, write, execute",
  },
  {
    id: "plan",
    icon: ListTodo,
    i18nKey: "planner.modes.plan",
    name: "Plan",
    description: "Draft a plan file for user review — no direct edits",
  },
  {
    id: "investigate",
    icon: Search,
    i18nKey: "planner.modes.investigate",
    name: "Ask",
    description: "Read-only research — search + read + ask",
  },
];

export function getAgentExecModeEntry(id: string): AgentExecModeEntry {
  return AGENT_EXEC_MODES.find((mode) => mode.id === id) ?? AGENT_EXEC_MODES[0];
}

// ============================================
// Running location
// ============================================

export type RunningLocation = "local" | "worktree" | "cloud";

export const DEFAULT_RUNNING_LOCATION: RunningLocation = "local";

export interface RunningLocationEntry {
  id: RunningLocation;
  icon: typeof Laptop;
  i18nKey: string;
  name: string;
  description: string;
  disabled?: boolean;
}

export type { AdvancedConfig } from "@src/features/SessionCreator/types";

export const RUNNING_LOCATIONS: RunningLocationEntry[] = [
  {
    id: "local",
    icon: Laptop,
    i18nKey: "planner.runningLocation.local",
    name: "This Mac",
    description: "Run on this device",
  },
  {
    id: "worktree",
    icon: GitBranchPlus,
    i18nKey: "planner.runningLocation.worktree",
    name: "New Worktree",
    description: "Run in a new git worktree",
  },
  {
    id: "cloud",
    icon: Cloud,
    i18nKey: "planner.runningLocation.cloud",
    name: "Cloud",
    description: "Run in the cloud",
    disabled: true,
  },
];
