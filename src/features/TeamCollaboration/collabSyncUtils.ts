import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_SYNC_BACKEND,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  CollabSessionAccessSettings,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

export interface SupabaseSyncProfile {
  supabaseUrl: string;
  anonKey: string;
  orgSecret: string;
}

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

export function isSessionPushAllowed(
  session: Session,
  org: CollabOrgRecord,
  settings: CollabSessionAccessSettings
): boolean {
  if (settings.accessMode === COLLAB_SESSION_ACCESS_MODE.OFF) return false;
  return isLocalSessionInOrgScope(session, org);
}

export function isRemoteSessionEventsPublishAllowed(
  session: RemoteTeammateSessionMetadata,
  org: CollabOrgRecord,
  settings: CollabSessionAccessSettings
): boolean {
  if (settings.accessMode !== COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY) {
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

export function getSyncProfile(
  org: CollabOrgRecord
): SupabaseSyncProfile | null {
  if (org.syncBackend !== COLLAB_SYNC_BACKEND.SUPABASE) return null;
  if (!org.supabaseUrl || !org.supabaseAnonKey || !org.orgSecret) return null;
  return {
    supabaseUrl: org.supabaseUrl,
    anonKey: org.supabaseAnonKey,
    orgSecret: org.orgSecret,
  };
}

export function toRemoteMetadata(
  session: Session,
  org: CollabOrgRecord,
  member: CollabMemberRecord,
  settings: CollabSessionAccessSettings
): RemoteTeammateSessionMetadata {
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
    accessMode: settings.accessMode,
    eventsBlobPath: undefined,
    eventsContentHash: undefined,
    eventsUpdatedAt: undefined,
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
