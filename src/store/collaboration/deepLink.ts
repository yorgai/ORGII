/**
 * Pure helpers for the `orgii://collaboration/*` deep links:
 *   - `orgii://collaboration/join`    → org invite (JOIN flow prefill);
 *   - `orgii://collaboration/session` → session share link (design §6.4).
 *
 * The URL scheme `orgii://` is the OS-level deep link protocol registered in
 * `src-tauri/tauri.conf.json` (`deep-link.desktop.schemes`). Without an
 * explicit branch here a collaboration deep link would fall through to the
 * generic route conversion and dead-end on an unregistered route — every new
 * collaboration path MUST be matched explicitly.
 *
 * Kept free of React / Jotai / Tauri imports so the parsing and the
 * "is this a collab link?" decision can be unit tested in isolation.
 */
import {
  parseCollabInviteInput,
  parseCollabSessionShareLink,
} from "./protocol";

export const COLLAB_JOIN_DEEP_LINK_HOST = "collaboration";
export const COLLAB_JOIN_DEEP_LINK_PATH = "join";
export const COLLAB_SHARE_DEEP_LINK_PATH = "session";

export interface CollabJoinDeepLink {
  supabaseUrl?: string;
  anonKey?: string;
  inviteCode: string;
}

/**
 * Whether `url` is an `orgii://collaboration/join` deep link (regardless of
 * whether its query params are valid). Used to branch a deep link toward the
 * collaboration JOIN flow before falling back to generic route conversion.
 */
export function isCollabJoinDeepLink(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("orgii://")) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
    return (
      host === COLLAB_JOIN_DEEP_LINK_HOST && path === COLLAB_JOIN_DEEP_LINK_PATH
    );
  } catch {
    return false;
  }
}

/**
 * Parse an `orgii://collaboration/join?sync=supabase&supabase=…&invite=…`
 * deep link into the values needed to prefill the JOIN form. Returns `null` for
 * anything that is not a valid collab-join link — including a missing invite
 * code, a malformed URL, a non-collaboration `orgii://` path, or any
 * `yorgai://` link. A missing Supabase URL is allowed because the user can
 * supply it manually. Query params are URL-decoded by `URLSearchParams`.
 */
export function parseCollabJoinDeepLink(
  url: string
): CollabJoinDeepLink | null {
  if (!isCollabJoinDeepLink(url)) return null;
  try {
    const { supabaseUrl, anonKey, inviteCode } = parseCollabInviteInput(
      url.trim()
    );
    return { supabaseUrl, anonKey, inviteCode };
  } catch {
    return null;
  }
}

export interface CollabShareDeepLink {
  supabaseUrl?: string;
  anonKey?: string;
  orgId?: string;
  shareToken: string;
  /**
   * Combined share+invite link (design §6.4): the share is consumed first
   * (read-only import); this invite code then powers the "join this org" CTA
   * that routes into the existing pendingInvite flow. The two tokens stay
   * semantically independent — neither amplifies the other.
   */
  inviteCode?: string;
}

/**
 * Whether `url` is an `orgii://collaboration/session` share deep link
 * (regardless of whether its query params are valid). Mirrors
 * `isCollabJoinDeepLink`.
 */
export function isCollabShareDeepLink(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("orgii://")) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
    return (
      host === COLLAB_JOIN_DEEP_LINK_HOST &&
      path === COLLAB_SHARE_DEEP_LINK_PATH
    );
  } catch {
    return false;
  }
}

/**
 * Parse an `orgii://collaboration/session?sync=supabase&supabase=…&org=…&
 * share=…[&invite=…]` deep link (built by buildCollabSessionShareLink).
 * Returns `null` for anything that is not a valid share link — including a
 * missing share token, a malformed URL, or a non-share collaboration path.
 */
export function parseCollabShareDeepLink(
  url: string
): CollabShareDeepLink | null {
  if (!isCollabShareDeepLink(url)) return null;
  try {
    const trimmed = url.trim();
    const { supabaseUrl, anonKey, orgId, shareToken } =
      parseCollabSessionShareLink(trimmed);
    const inviteCode =
      new URL(trimmed).searchParams.get("invite")?.trim() || undefined;
    return { supabaseUrl, anonKey, orgId, shareToken, inviteCode };
  } catch {
    return null;
  }
}
