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

export interface CollabAvatarIdentity {
  initials: string;
  variant: string;
}

export interface CollabOrgRecord {
  id: string;
  name: string;
  hubUrl?: string;
  groupId?: string;
  adminMemberId?: string;
  createdAt: string;
}

export interface CollabMemberRecord {
  id: string;
  orgId: string;
  displayName: string;
  avatar: CollabAvatarIdentity;
  role: CollabRole;
  identityKind: CollabIdentityKind;
  accessToken?: string;
  joinedAt: string;
  removedAt?: string;
}

export interface CollabInviteRecord {
  id: string;
  orgId: string;
  hubUrl: string;
  inviteCode: string;
  inviteLink: string;
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface CollabOrgConnectionState {
  orgId: string;
  status: CollabConnectionStatus;
  error?: string;
  updatedAt: string;
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
}
