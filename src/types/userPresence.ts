/**
 * User Presence Types
 *
 * QQ-style availability the user controls from the sidebar footer. The
 * value travels with every agent turn (piggy-backing on the IDE context
 * payload) and surfaces in the system prompt via the
 * `user_presence` section so the agent can adapt its behavior to whether
 * the human is watching, hiding, or away.
 *
 * The three built-in modes (`online`, `invisible`, `away`) are always
 * present and have first-class UI affordances (icon, color, away-back-at
 * scheduling). On top of those, the user can define any number of
 * **custom roles** in Settings → My Role; each custom role is identified
 * by a `role:<slug>` mode id, carries its own guidance text, and is
 * surfaced in the same presence pill dropdown.
 */

export const USER_PRESENCE_MODE = {
  ONLINE: "online",
  INVISIBLE: "invisible",
  AWAY: "away",
} as const;

export type BuiltInPresenceMode =
  (typeof USER_PRESENCE_MODE)[keyof typeof USER_PRESENCE_MODE];

/**
 * Active presence mode. Either one of the three built-in modes above or a
 * custom-role mode id of the form `role:<slug>` (slug must be lowercase
 * alphanumerics + dashes; see `CUSTOM_ROLE_MODE_PREFIX`).
 */
export type UserPresenceMode = BuiltInPresenceMode | string;

export const USER_PRESENCE_MODES: BuiltInPresenceMode[] = [
  USER_PRESENCE_MODE.ONLINE,
  USER_PRESENCE_MODE.INVISIBLE,
  USER_PRESENCE_MODE.AWAY,
];

export const CUSTOM_ROLE_MODE_PREFIX = "role:";

export function isBuiltInPresenceMode(
  mode: UserPresenceMode
): mode is BuiltInPresenceMode {
  return (USER_PRESENCE_MODES as readonly string[]).includes(mode);
}

export function isCustomRoleMode(mode: UserPresenceMode): boolean {
  return mode.startsWith(CUSTOM_ROLE_MODE_PREFIX);
}

export function buildCustomRoleMode(roleId: string): UserPresenceMode {
  return `${CUSTOM_ROLE_MODE_PREFIX}${roleId}`;
}

export function parseCustomRoleId(mode: UserPresenceMode): string | null {
  return isCustomRoleMode(mode)
    ? mode.slice(CUSTOM_ROLE_MODE_PREFIX.length)
    : null;
}

/**
 * Wire shape sent to the Rust runtime. Matches `UserPresence` in
 * `src-tauri/crates/agent-core/src/core/session/types/context.rs`.
 */
export interface UserPresenceWire {
  mode: UserPresenceMode;
  /** ISO-8601 timestamp the user expects to be back (Away only). */
  backAt?: string;
  /** Per-mode prompt addendum configured in Settings → General. */
  guidance?: string;
}

/**
 * Local state shape persisted in the user presence atom. Carries the
 * extra UI bookkeeping (selected away duration) that the wire form
 * doesn't need.
 */
export interface UserPresenceState {
  mode: UserPresenceMode;
  /** Epoch milliseconds when the user expects to be back (Away only). */
  backAtMs?: number;
  /** Convenience label for the Away duration ("30m", "2h", "tomorrow"). */
  awayDurationLabel?: string;
}

export const AWAY_DURATIONS: ReadonlyArray<{
  id: string;
  labelKey: string;
  minutes: number;
}> = [
  {
    id: "15m",
    labelKey: "navigation:sidebar.presence.duration15m",
    minutes: 15,
  },
  {
    id: "30m",
    labelKey: "navigation:sidebar.presence.duration30m",
    minutes: 30,
  },
  { id: "1h", labelKey: "navigation:sidebar.presence.duration1h", minutes: 60 },
  {
    id: "2h",
    labelKey: "navigation:sidebar.presence.duration2h",
    minutes: 120,
  },
  {
    id: "tomorrow",
    labelKey: "navigation:sidebar.presence.durationTomorrow",
    minutes: -1,
  },
];

export function computeBackAtMs(
  durationId: string,
  fromMs = Date.now()
): number {
  const found = AWAY_DURATIONS.find((entry) => entry.id === durationId);
  if (!found) return fromMs + 30 * 60_000;
  if (found.minutes >= 0) {
    return fromMs + found.minutes * 60_000;
  }
  const next = new Date(fromMs);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.getTime();
}

// ────────────────────────────────────────────────────────────────────
// Custom roles
// ────────────────────────────────────────────────────────────────────
//
// Custom roles are an open-ended extension of the built-in three modes
// (Online / Invisible / Away). The user manages them in Settings →
// My Role. Each role gets its own guidance string that's shipped to
// the agent in place of the built-in guidance when that role is the
// active presence mode.

/**
 * Picker palette for custom-role icons. Stored as a string id so the
 * persisted shape doesn't depend on a component reference. The pill /
 * dropdown look up the actual lucide component via `CUSTOM_ROLE_ICONS`
 * in `src/scaffold/NavigationSidebar/blocks/customRoleIcons.ts`.
 */
export type CustomRoleIconId =
  | "user"
  | "briefcase"
  | "code"
  | "rocket"
  | "coffee"
  | "headphones"
  | "book"
  | "compass"
  | "feather"
  | "flame"
  | "shield"
  | "sparkles";

export interface CustomRoleDefinition {
  /** Stable id (slug). Used to build the wire mode `role:<id>`. */
  id: string;
  /** Display name shown in the pill + dropdown. */
  label: string;
  /** Icon id from the curated palette. */
  iconId: CustomRoleIconId;
  /** Per-mode prompt addendum shipped to the agent. */
  guidance: string;
  /** Epoch ms — `Date.now()` at creation; used to keep the list stable. */
  createdAtMs: number;
}
