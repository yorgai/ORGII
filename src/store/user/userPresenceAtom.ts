/**
 * User Presence Atom
 *
 * QQ-style availability the user toggles from the sidebar footer. Persisted
 * to `localStorage` so the chosen mode survives reloads. Read by:
 *
 * - `SidebarBottomBar` → renders the presence pill + menu.
 * - `IdeContextCollector` → ships the wire snapshot with every agent turn.
 *
 * The atom holds the local-only `UserPresenceState` (mode + back-at + label);
 * conversion to the wire shape happens in `selectUserPresenceWire` so the
 * Rust agent never sees the convenience fields.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import { settingsAtom } from "@src/store/settings/settingsAtom";
import {
  type BuiltInPresenceMode,
  USER_PRESENCE_MODE,
  type UserPresenceMode,
  type UserPresenceState,
  type UserPresenceWire,
  isBuiltInPresenceMode,
  parseCustomRoleId,
} from "@src/types/userPresence";

import { customRoleByIdAtom } from "./userRolesAtom";

const STORAGE_KEY = "orgii:userPresence";

const DEFAULT_PRESENCE: UserPresenceState = {
  mode: USER_PRESENCE_MODE.ONLINE,
};

export const userPresenceAtom = atomWithStorage<UserPresenceState>(
  STORAGE_KEY,
  DEFAULT_PRESENCE
);

/**
 * Derived: writable convenience for changing just the mode. Clears Away
 * bookkeeping when leaving Away so a subsequent Away pick starts fresh.
 */
export const userPresenceModeAtom = atom(
  (get) => get(userPresenceAtom).mode,
  (get, set, next: UserPresenceMode) => {
    const current = get(userPresenceAtom);
    if (next === USER_PRESENCE_MODE.AWAY) {
      set(userPresenceAtom, { ...current, mode: next });
      return;
    }
    set(userPresenceAtom, {
      mode: next,
      backAtMs: undefined,
      awayDurationLabel: undefined,
    });
  }
);

function builtInGuidanceKey(mode: BuiltInPresenceMode): string {
  switch (mode) {
    case USER_PRESENCE_MODE.ONLINE:
      return "general.presenceGuidanceOnline";
    case USER_PRESENCE_MODE.INVISIBLE:
      return "general.presenceGuidanceInvisible";
    case USER_PRESENCE_MODE.AWAY:
      return "general.presenceGuidanceAway";
  }
}

/**
 * Derived: wire snapshot for the agent runtime. Combines the current
 * presence with the per-mode guidance string. For built-in modes that's
 * the textarea in Settings → My Role; for custom-role modes it's the
 * `guidance` field on the role definition itself. Returns `undefined`
 * only when the resolution produces no meaningful content (e.g. a stale
 * `role:<id>` mode whose role was deleted) — the consumer then skips the
 * `user_presence` system-prompt section entirely.
 */
export const userPresenceWireAtom = atom<UserPresenceWire | undefined>(
  (get) => {
    const presence = get(userPresenceAtom);

    let guidance: string | undefined;
    if (isBuiltInPresenceMode(presence.mode)) {
      const settings = get(settingsAtom);
      const raw =
        settings[builtInGuidanceKey(presence.mode) as keyof typeof settings];
      guidance =
        typeof raw === "string" && raw.trim().length > 0
          ? raw.trim()
          : undefined;
    } else {
      const roleId = parseCustomRoleId(presence.mode);
      if (roleId) {
        const role = get(customRoleByIdAtom).get(roleId);
        guidance =
          role && role.guidance.trim().length > 0
            ? role.guidance.trim()
            : undefined;
      }
    }

    const wire: UserPresenceWire = { mode: presence.mode };

    if (presence.mode === USER_PRESENCE_MODE.AWAY && presence.backAtMs) {
      wire.backAt = new Date(presence.backAtMs).toISOString();
    }

    if (guidance) {
      wire.guidance = guidance;
    }

    return wire;
  }
);
