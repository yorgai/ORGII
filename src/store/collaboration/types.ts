export const COLLAB_ROLE = {
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type CollabRole = (typeof COLLAB_ROLE)[keyof typeof COLLAB_ROLE];

export const COLLAB_IDENTITY_KIND = {
  HUMAN: "human",
  AGENT: "agent",
} as const;

export type CollabIdentityKind =
  (typeof COLLAB_IDENTITY_KIND)[keyof typeof COLLAB_IDENTITY_KIND];

export const COLLAB_CONNECTION_STATUS = {
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ERROR: "error",
} as const;

export type CollabConnectionStatus =
  (typeof COLLAB_CONNECTION_STATUS)[keyof typeof COLLAB_CONNECTION_STATUS];

export const COLLAB_SYNC_BACKEND = {
  SUPABASE: "supabase",
} as const;

export type CollabSyncBackend =
  (typeof COLLAB_SYNC_BACKEND)[keyof typeof COLLAB_SYNC_BACKEND];

export const SUPABASE_SYNC_SCHEMA_VERSION = 2;

export const SUPABASE_SESSION_SNAPSHOT_BUCKET = "orgii-session-snapshots";

export const COLLAB_SESSION_ACCESS_MODE = {
  OFF: "off",
  METADATA_ONLY: "metadata_only",
  FULL_REPLAY: "full_replay",
} as const;

export type CollabSessionAccessMode =
  (typeof COLLAB_SESSION_ACCESS_MODE)[keyof typeof COLLAB_SESSION_ACCESS_MODE];

/**
 * Server-side session visibility (design §6.2). Derived from the owner's
 * effective access mode at push time; a null column on pre-M4 rows is read
 * as 'org' by every server filter.
 */
export const COLLAB_SESSION_VISIBILITY = {
  ORG: "org",
  RESTRICTED: "restricted",
} as const;

export type CollabSessionVisibility =
  (typeof COLLAB_SESSION_VISIBILITY)[keyof typeof COLLAB_SESSION_VISIBILITY];

/**
 * Replay depth of a shared session / share grant (design §6.2):
 * 'metadata' — listing only; 'replay' — event segments included.
 */
export const COLLAB_SESSION_REPLAY_LEVEL = {
  METADATA: "metadata",
  REPLAY: "replay",
} as const;

export type CollabSessionReplayLevel =
  (typeof COLLAB_SESSION_REPLAY_LEVEL)[keyof typeof COLLAB_SESSION_REPLAY_LEVEL];

export const COLLAB_WORKSPACE_SCOPE = {
  SELECTED_WORKSPACES: "selected_workspaces",
} as const;

export type CollabWorkspaceScope =
  (typeof COLLAB_WORKSPACE_SCOPE)[keyof typeof COLLAB_WORKSPACE_SCOPE];

export const COLLAB_REPO_JOIN_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type CollabRepoJoinStatus =
  (typeof COLLAB_REPO_JOIN_STATUS)[keyof typeof COLLAB_REPO_JOIN_STATUS];

export interface CollabAvatarIdentity {
  initials: string;
  variant: string;
}

export interface SupabaseSyncProfile {
  backend: typeof COLLAB_SYNC_BACKEND.SUPABASE;
  supabaseUrl: string;
  anonKey: string;
  orgSecret: string;
  schemaVersion: number;
}

export interface CollabOrgRecord {
  id: string;
  name: string;
  projectOrgId?: string;
  syncBackend?: CollabSyncBackend;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  orgSecret?: string;
  memberToken?: string;
  groupId?: string;
  adminMemberId?: string;
  localMemberId?: string;
  repoScopes?: string[];
  createdAt: string;
}

export interface CollabMemberRecord {
  id: string;
  orgId: string;
  displayName: string;
  avatar: CollabAvatarIdentity;
  role: CollabRole;
  identityKind: CollabIdentityKind;
  joinedAt: string;
  removedAt?: string;
}

export interface CollabInviteRecord {
  id: string;
  orgId: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  // Plaintext invite code/link exist only on the creating client; the server
  // stores display metadata (codeSuffix, limits, role) plus the code hash.
  inviteCode?: string;
  inviteLink?: string;
  usageLimit: number;
  usageCount: number;
  role?: CollabRole;
  codeSuffix?: string;
  createdByMemberId?: string;
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export type CollabProjectMetadataRecord = Record<string, unknown>;

export type CollabWorkItemMetadataRecord = Record<string, unknown>;

export interface CollabOrgConnectionState {
  orgId: string;
  status: CollabConnectionStatus;
  error?: string;
  updatedAt: string;
}

export interface CollabChatMessageRecord {
  id: string;
  orgId: string;
  authorMemberId: string;
  authorDisplayName: string;
  authorIdentityKind: CollabIdentityKind;
  body: string;
  createdAt: string;
}

export interface CollabSessionAccessSettings {
  orgId: string;
  memberId: string;
  accessMode: CollabSessionAccessMode;
  /**
   * Per-session escape hatch (design §6.3): overrides accessMode AND the
   * shareSince gate for the keyed sourceSessionId. Any change here must be
   * mirrored in CollabSessionAccessSettingsSchema — zod strips unknown keys
   * on hydrate.
   */
  sessionOverrides?: Record<string, CollabSessionAccessMode>;
  /**
   * "Only share sessions created from here on" (design §6.3): sessions with
   * created_at before this ISO timestamp are treated as OFF unless they
   * carry an explicit sessionOverrides entry. Gate is by CREATION time, not
   * last activity — reopening an old session must not leak its history.
   */
  shareSince?: string;
  workspaceScope: CollabWorkspaceScope;
  workspacePaths: string[];
  updatedAt: string;
}

export interface CollabSessionSnapshotRequestRecord {
  requestId: string;
  orgId: string;
  requesterMemberId: string;
  ownerMemberId: string;
  sourceSessionId: string;
  createdAt: string;
  status: "pending" | "sent" | "denied" | "completed" | "failed";
  error?: string;
}

export interface CollabRepoJoinRequestRecord {
  requestId: string;
  orgId: string;
  requesterMemberId: string;
  repoPath: string;
  status: CollabRepoJoinStatus;
  reviewerMemberId?: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface RemoteTeammateSessionMetadata {
  id: string;
  orgId: string;
  ownerMemberId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  ownerIdentityKind: CollabIdentityKind;
  sourceSessionId: string;
  title: string;
  status?: string;
  repoPath?: string;
  branch?: string;
  lastActivityAt?: string;
  accessMode?: CollabSessionAccessMode;
  // Sharing plane (design §6.2): server columns fed from these payload
  // fields at push time. Absent on pre-M4 rows (server reads null as 'org').
  visibility?: CollabSessionVisibility;
  replayLevel?: CollabSessionReplayLevel;
  // Segments summary (design §7.3): mirrors the orgii_sessions summary
  // columns. All undefined ⇒ the owner has not published event segments.
  eventsEpoch: number | undefined;
  eventsFrozenSeq: number | undefined;
  eventsCount: number | undefined;
  eventsTailHash: string | undefined;
  deletedAt?: string;
}
