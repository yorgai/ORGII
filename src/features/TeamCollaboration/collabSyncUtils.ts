import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_SESSION_REPLAY_LEVEL,
  COLLAB_SESSION_VISIBILITY,
  COLLAB_SYNC_BACKEND,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type { CollabSessionAccessMode } from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  CollabSessionAccessSettings,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import type { CollabSyncProfile } from "./sync/CollabSyncBackend";

export type { CollabSyncProfile as SupabaseSyncProfile } from "./sync/CollabSyncBackend";

export function normalizeRepoPath(
  path: string | undefined | null
): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export function isRepoPathInScope(
  repoPath: string | undefined | null,
  orgRepoScopes: string[] | undefined
): boolean {
  const normalized = normalizeRepoPath(repoPath);
  if (!normalized) return false;
  if (!orgRepoScopes || orgRepoScopes.length === 0) return false;
  return orgRepoScopes.some((scope) => normalizeRepoPath(scope) === normalized);
}

export function isLocalSessionInOrgScope(
  session: Session,
  org: CollabOrgRecord
): boolean {
  return isRepoPathInScope(session.repoPath, org.repoScopes);
}

export function isRemoteSessionInOrgScope(
  session: RemoteTeammateSessionMetadata,
  org: CollabOrgRecord
): boolean {
  return isRepoPathInScope(session.repoPath, org.repoScopes);
}

/**
 * Effective access mode for ONE session under ONE org's settings (design
 * §6.3). Resolution order:
 * 1. an explicit `sessionOverrides` entry wins outright — it is the escape
 *    hatch that can re-share a pre-shareSince session (or silence a new one);
 * 2. otherwise the `shareSince` gate: with shareSince set, sessions CREATED
 *    before it resolve to OFF (creation time, not last activity — reopening
 *    an old session must not drag its full history to the org). Unparseable
 *    timestamps on either side also gate to OFF: when we cannot prove the
 *    session is new, privacy wins;
 * 3. otherwise the member-level default `accessMode`.
 */
export function getEffectiveAccessMode(
  session: Pick<Session, "session_id" | "created_at">,
  settings: CollabSessionAccessSettings
): CollabSessionAccessMode {
  const override = settings.sessionOverrides?.[session.session_id];
  if (override) return override;
  if (settings.shareSince) {
    const createdAtMs = Date.parse(session.created_at);
    const shareSinceMs = Date.parse(settings.shareSince);
    const createdAfterShareSince =
      Number.isFinite(createdAtMs) &&
      Number.isFinite(shareSinceMs) &&
      createdAtMs >= shareSinceMs;
    if (!createdAfterShareSince) return COLLAB_SESSION_ACCESS_MODE.OFF;
  }
  return settings.accessMode;
}

export function isSessionPushAllowed(
  session: Session,
  org: CollabOrgRecord,
  settings: CollabSessionAccessSettings
): boolean {
  // Imported teammate sessions must never be pushed back, or every
  // consumer re-uploads them under its own member id (org-wide echo loop).
  if (session.category === "external_history") return false;
  if (session.importedFrom) return false;
  if (
    getEffectiveAccessMode(session, settings) === COLLAB_SESSION_ACCESS_MODE.OFF
  ) {
    return false;
  }
  return isLocalSessionInOrgScope(session, org);
}

export function isRemoteSessionEventsPublishAllowed(
  session: RemoteTeammateSessionMetadata,
  org: CollabOrgRecord,
  settings: CollabSessionAccessSettings
): boolean {
  // The metadata's accessMode carries the per-session EFFECTIVE mode when it
  // was built by toRemoteMetadata; fall back to the member default for
  // records that predate the override model.
  const mode = session.accessMode ?? settings.accessMode;
  if (mode !== COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY) {
    return false;
  }
  return isRemoteSessionInOrgScope(session, org);
}

export function createDefaultAccessSettings(
  orgId: string,
  memberId: string
): CollabSessionAccessSettings {
  return {
    orgId,
    memberId,
    accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getSyncProfile(org: CollabOrgRecord): CollabSyncProfile | null {
  if (org.syncBackend !== COLLAB_SYNC_BACKEND.SUPABASE) return null;
  if (!org.supabaseUrl || !org.supabaseAnonKey) return null;
  const hasMemberCredential = Boolean(org.memberToken && org.localMemberId);
  if (!hasMemberCredential && !org.orgSecret) return null;
  return {
    supabaseUrl: org.supabaseUrl,
    anonKey: org.supabaseAnonKey,
    orgSecret: org.orgSecret,
    memberId: org.localMemberId,
    memberToken: org.memberToken,
  };
}

export function toRemoteMetadata(
  session: Session,
  org: CollabOrgRecord,
  member: CollabMemberRecord,
  settings: CollabSessionAccessSettings
): RemoteTeammateSessionMetadata {
  const effectiveMode = getEffectiveAccessMode(session, settings);
  return {
    id: `${org.id}:${member.id}:${session.session_id}`,
    orgId: org.id,
    ownerMemberId: member.id,
    ownerUserId: member.id,
    ownerDisplayName: member.displayName,
    ownerIdentityKind: member.identityKind,
    sourceSessionId: session.session_id,
    title: session.name || session.user_input || session.session_id,
    status: String(session.status),
    repoPath: session.repoPath,
    branch: session.branch || session.worktreeBranch,
    lastActivityAt: session.updated_at || session.updated_time,
    accessMode: effectiveMode,
    // Sharing plane (design §6.2): 'restricted' arrives with the M4b UI —
    // M4a always publishes org-visible; the field is wired through so the
    // server column populates. replayLevel derives from the effective mode.
    visibility: COLLAB_SESSION_VISIBILITY.ORG,
    replayLevel:
      effectiveMode === COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY
        ? COLLAB_SESSION_REPLAY_LEVEL.REPLAY
        : COLLAB_SESSION_REPLAY_LEVEL.METADATA,
    // Segments summary is server-owned (append/rewrite RPCs maintain it);
    // metadata pushes never carry it.
    eventsEpoch: undefined,
    eventsFrozenSeq: undefined,
    eventsCount: undefined,
    eventsTailHash: undefined,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Deterministic JSON with recursively sorted object keys. Used for the
 * per-event hash vector of the segments push protocol (design §7.3 step 2):
 * event objects are rebuilt by serde on every read, so hashing must not
 * depend on incidental key order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(",")}}`;
}
