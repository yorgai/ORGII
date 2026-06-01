/**
 * User Custom Roles
 *
 * Persistent list of user-defined presence roles that augment the three
 * built-in modes (Online / Invisible / Away). Managed from Settings →
 * My Role; consumed by:
 *
 * - `PresenceMenuButton` — adds them to the dropdown alongside built-ins.
 * - `userPresenceWireAtom` — when the active mode is a custom role, ships
 *   the role's guidance to the agent in place of the built-in addendum.
 *
 * Storage is local-only (`localStorage`). There's no backend sync: roles
 * are a personal organization tool, the same scope as the presence mode
 * itself.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

import type { CustomRoleDefinition } from "@src/types/userPresence";

const STORAGE_KEY = "orgii:userCustomRoles";

export const userCustomRolesAtom = atomWithStorage<CustomRoleDefinition[]>(
  STORAGE_KEY,
  []
);

/** Lookup by id for the wire / pill renderers. */
export const customRoleByIdAtom = atom((get) => {
  const roles = get(userCustomRolesAtom);
  const map = new Map<string, CustomRoleDefinition>();
  for (const role of roles) map.set(role.id, role);
  return map;
});

/**
 * Generate a stable slug from a label, ensuring it doesn't collide with
 * any existing role's id. Falls back to a numeric suffix on collision.
 */
export function generateRoleId(
  label: string,
  taken: ReadonlySet<string>
): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "role";

  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
