import {
  RUST_AGENT_TYPE,
  type RustAgentType,
} from "@src/api/tauri/agent/types";
import type { DispatchCategory } from "@src/api/tauri/session";

/**
 * Session Dispatch Utilities
 *
 * Centralized detection for session dispatch routing based on session ID prefixes.
 * Use these helpers instead of ad-hoc string checks throughout the codebase.
 *
 * Two orthogonal concepts:
 *
 * 1. Dispatch category (transport/routing):
 *    - "cli_agent": CLI Agent session (external CLI process via Tauri)
 *    - "rust_agent": Rust-native agent session (OS Agent, SDE Agent, Custom)
 *
 * 2. Key source (billing / own key vs hosted key):
 *    - "own_key": User's own API keys (BYOK)
 *    - "hosted_key": Hosted ORGII key (proxied via the marketplace)
 *
 * Key source is stored on the session record, not derived from session ID.
 */

// ============================================
// Session Prefixes Registry
// ============================================

/**
 * Session prefix configuration.
 * When adding a new agent type, add an entry here — all detection functions
 * will automatically recognize it.
 */
export interface SessionPrefixConfig {
  /** The prefix string (e.g., "osagent-") */
  prefix: string;
  /** Session category for adapter resolution */
  category: DispatchCategory;
  /** Agent variant for Rust-native agents; undefined for non-agent sessions */
  variant?: RustAgentType;
  /** Lucide icon slug for UI display */
  iconId: string;
  /** Agent definition ID for built-in agents (e.g., "builtin:os") */
  defId?: string;
}

/**
 * Registry of all known session prefixes.
 * Order matters: first match wins for prefix detection.
 */
export const SESSION_PREFIX_REGISTRY: readonly SessionPrefixConfig[] = [
  {
    prefix: "osagent-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.OS,
    iconId: "omega",
    defId: "builtin:os",
  },
  {
    prefix: "guicontrol-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.GUI_CONTROL,
    iconId: "mouse-pointer-click",
    defId: "builtin:gui-control",
  },
  {
    prefix: "sdeagent-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.SDE,
    iconId: "code",
    defId: "builtin:sde",
  },
  {
    prefix: "wingman-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.WINGMAN,
    iconId: "hand-metal",
    defId: "builtin:wingman",
  },
  {
    prefix: "terminalagent-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.TERMINAL,
    iconId: "terminal",
    defId: "builtin:terminal",
  },
  {
    prefix: "agentsession-",
    category: "rust_agent",
    variant: RUST_AGENT_TYPE.SDE,
    iconId: "code",
  },
  {
    prefix: "cliagent-",
    category: "cli_agent",
    variant: undefined,
    iconId: "terminal",
  },
  {
    prefix: "cursoride-",
    category: "cursor_ide",
    variant: undefined,
    // Use the Cursor brand mark — these rows surface chat history captured
    // by the Cursor IDE itself, so the brand icon is the most honest
    // affordance. Resolved via `resolveAgentIcon("cursor")` →
    // `CursorBrandIcon` adapter (see `src/config/agentIcons.tsx`).
    iconId: "cursor",
  },
] as const;

// ============================================
// Derived Constants (for backward compatibility)
// ============================================

/** Prefix for OS Agent session IDs */
export const OS_AGENT_SESSION_PREFIX = "osagent-";

/** Prefix for ORGII GUI Control Agent session IDs */
export const GUI_CONTROL_SESSION_PREFIX = "guicontrol-";

/** Prefix for SDE Agent session IDs (Rust-native coding agent) */
export const SDE_AGENT_SESSION_PREFIX = "sdeagent-";

/** Prefix for CLI Agent session IDs */
export const CLI_SESSION_PREFIX = "cliagent-";

/**
 * Prefix for Cursor IDE history session IDs. The bare composer UUID from
 * Cursor's `state.vscdb` is wrapped as `${CURSOR_IDE_SESSION_PREFIX}${uuid}`
 * before crossing into our system; the prefix is stripped only inside the
 * `cursor_ide_chunks` Tauri command. Frontend code never sees the bare UUID.
 */
export const CURSOR_IDE_SESSION_PREFIX = "cursoride-";

/** Prefix for Wingman Agent session IDs */
export const WINGMAN_SESSION_PREFIX = "wingman-";

/** Prefix for Terminal Agent session IDs */
export const TERMINAL_AGENT_SESSION_PREFIX = "terminalagent-";

/** Agent definition ID for the built-in OS Agent */
export const BUILTIN_OS_DEF_ID = "builtin:os";

/** Agent definition ID for the built-in ORGII GUI Control Agent */
export const BUILTIN_GUI_CONTROL_DEF_ID = "builtin:gui-control";

/** Agent definition ID for the built-in SDE Agent */
export const BUILTIN_SDE_DEF_ID = "builtin:sde";

/** Agent definition ID for the built-in Wingman Agent */
export const BUILTIN_WINGMAN_DEF_ID = "builtin:wingman";

/** Agent definition ID for the built-in Terminal Agent */
export const BUILTIN_TERMINAL_DEF_ID = "builtin:terminal";

// ============================================
// Internal Helpers
// ============================================

/**
 * Find the matching prefix config for a session ID.
 */
function findPrefixConfig(
  sessionId: string | null | undefined
): SessionPrefixConfig | undefined {
  if (!sessionId) return undefined;
  return SESSION_PREFIX_REGISTRY.find((config) =>
    sessionId.startsWith(config.prefix)
  );
}

// ============================================
// Detection Functions
// ============================================

/**
 * Check if a session ID belongs to a CLI Agent session.
 */
export function isCliSession(sessionId: string | null | undefined): boolean {
  const config = findPrefixConfig(sessionId);
  return config?.category === "cli_agent";
}

/**
 * Check if a session ID belongs to a Cursor IDE history session (read-only).
 */
export function isCursorIdeSession(
  sessionId: string | null | undefined
): boolean {
  const config = findPrefixConfig(sessionId);
  return config?.category === "cursor_ide";
}

/**
 * Check if a session ID belongs to a Wingman agent session.
 */
export function isWingmanSession(
  sessionId: string | null | undefined
): boolean {
  const config = findPrefixConfig(sessionId);
  return config?.variant === RUST_AGENT_TYPE.WINGMAN;
}

/**
 * Check if a session ID belongs to a Rust-native agent session.
 * Matches `osagent-` and `sdeagent-` prefixes (NOT drafts or CLI).
 */
export function isAgentSession(sessionId: string | null | undefined): boolean {
  const config = findPrefixConfig(sessionId);
  return (
    config?.category === "rust_agent" &&
    config?.variant !== undefined &&
    config?.variant !== RUST_AGENT_TYPE.CUSTOM
  );
}

/**
 * Derive the dispatch category from a session ID.
 * Returns the routing category based on ID prefix.
 *
 * Uses the prefix registry for consistent resolution.
 */
export function getDispatchCategory(sessionId: string): DispatchCategory {
  const config = findPrefixConfig(sessionId);
  return config?.category ?? "rust_agent";
}

// ============================================
// Rust Agent Type Resolution
// ============================================

/**
 * Sub-classification within rust_agent sessions.
 * Re-exports `RustAgentType` from the canonical `RUST_AGENT_TYPE` definition.
 */
export type { RustAgentType } from "@src/api/tauri/agent/types";

/**
 * Derive the Rust agent type from a session ID prefix or agent definition ID.
 * Accepts either a `sessionId` string (prefix-based) or a `defId` string (e.g. "builtin:os").
 *
 * Uses the prefix registry for consistent resolution.
 */
export function getRustAgentType(
  sessionIdOrDefId: string | null | undefined
): RustAgentType {
  if (!sessionIdOrDefId) return RUST_AGENT_TYPE.CUSTOM;

  // Check by prefix first
  const config = findPrefixConfig(sessionIdOrDefId);
  if (config?.variant !== undefined) return config.variant;

  // Check by definition ID
  const defIdMatch = SESSION_PREFIX_REGISTRY.find(
    (cfg) => cfg.defId === sessionIdOrDefId
  );
  if (defIdMatch?.variant !== undefined) return defIdMatch.variant;

  return RUST_AGENT_TYPE.CUSTOM;
}

// ============================================
// Icon Resolution
// ============================================

/**
 * Strip the `cursoride-` prefix and return the bare Cursor composer UUID.
 *
 * Returns `null` when the id isn't a Cursor IDE session — use this for
 * defense-in-depth at call sites that already know the session is a
 * `cursoride-*` row (adapter dispatch, dispatcher, pill components).
 */
export function composerIdFromSessionId(sessionId: string): string | null {
  if (!sessionId.startsWith(CURSOR_IDE_SESSION_PREFIX)) return null;
  const tail = sessionId.slice(CURSOR_IDE_SESSION_PREFIX.length);
  return tail.length > 0 ? tail : null;
}

/**
 * Map a session ID to a Lucide icon slug based on its prefix.
 * Pair with `resolveAgentIcon()` from `@src/config/agentIcons` to get the component.
 *
 * Uses the prefix registry — no need to edit this function when adding new agents.
 */
export function resolveSessionIconId(
  sessionId: string | null | undefined
): string {
  if (!sessionId) return "bot";
  const config = findPrefixConfig(sessionId);
  return config?.iconId ?? "bot";
}
