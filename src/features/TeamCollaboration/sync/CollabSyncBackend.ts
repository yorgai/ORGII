import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type {
  CollabChatMessageRecord,
  CollabIdentityKind,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
  CollabProjectMetadataRecord,
  CollabRepoJoinRequestRecord,
  CollabRole,
  CollabWorkItemMetadataRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

// Credential model (schema v2): memberId + memberToken is the per-member
// credential; orgSecret is the root credential held by the org creator only.
// Every RPC call sends exactly one credential kind.
export interface CollabSyncProfile {
  supabaseUrl: string;
  anonKey: string;
  orgSecret?: string;
  memberId?: string;
  memberToken?: string;
}

export interface CreateOrgInput extends CollabSyncProfile {
  name: string;
  displayName: string;
  identityKind: CollabIdentityKind;
}

export interface AcceptInviteInput extends CollabSyncProfile {
  inviteCode: string;
  displayName: string;
  identityKind: CollabIdentityKind;
}

export interface CreateInviteInput extends CollabSyncProfile {
  orgId: string;
  usageLimit?: number;
  expiresAt?: string;
  role?: CollabRole;
}

export interface RevokeInviteInput extends CollabSyncProfile {
  orgId: string;
  inviteId: string;
}

export interface UpdateMemberRoleInput extends CollabSyncProfile {
  orgId: string;
  targetMemberId: string;
  role: CollabRole;
}

// targetMemberId is distinct from CollabSyncProfile.memberId (the caller's own
// credential id) — spreading a profile must not clobber the removal target.
export interface RemoveMemberInput extends CollabSyncProfile {
  orgId: string;
  targetMemberId: string;
}

export interface ListChatMessagesInput extends CollabSyncProfile {
  orgId: string;
  limit?: number;
}

export interface PostChatMessageInput extends CollabSyncProfile {
  orgId: string;
  memberId: string;
  authorDisplayName: string;
  authorIdentityKind: CollabIdentityKind;
  body: string;
}

export interface UpsertProjectMetadataInput extends CollabSyncProfile {
  orgId: string;
  project: CollabProjectMetadataRecord;
  /** OCC base version; defaults to `project.version` when omitted. */
  baseVersion?: number;
}

export interface UpsertWorkItemInput extends CollabSyncProfile {
  orgId: string;
  workItem: CollabWorkItemMetadataRecord;
  /** OCC base version; defaults to `workItem.version` when omitted. */
  baseVersion?: number;
}

export interface UpsertSessionMetadataInput extends CollabSyncProfile {
  session: RemoteTeammateSessionMetadata;
}

export interface RemoveSessionMetadataInput extends CollabSyncProfile {
  orgId: string;
  sourceSessionId: string;
  ownerMemberId: string;
}

export interface RequestSessionSnapshotInput extends CollabSyncProfile {
  requestId: string;
  orgId: string;
  requesterMemberId: string;
  ownerMemberId: string;
  sourceSessionId: string;
}

export interface PublishSessionSnapshotInput extends CollabSyncProfile {
  requestId: string;
  orgId: string;
  sourceSessionId: string;
  session: RemoteTeammateSessionMetadata;
  events: SessionEvent[];
}

export interface DenySessionSnapshotInput extends CollabSyncProfile {
  orgId: string;
  requestId: string;
  reason: string;
}

export interface ListOrgStateInput extends CollabSyncProfile {
  orgId: string;
  sinceTimestamp?: string;
}

// ---------------------------------------------------------------------------
// Segments data plane (design §7). Events are stored as an immutable frozen
// prefix (append-only numbered segments) plus one mutable tail segment.
// The client layer owns gzip + segment hashing; callers pass plain events.
// ---------------------------------------------------------------------------

/** One frozen segment to write: `seq` is server-side ordering (1-based). */
export interface SessionEventsSegmentInput {
  seq: number;
  events: SessionEvent[];
}

export interface AppendSessionEventsInput extends CollabSyncProfile {
  orgId: string;
  /** orgii_sessions.id (`${orgId}:${memberId}:${sourceSessionId}`). */
  sessionRowId: string;
  /** OCC anchor: must equal the server summary or the RPC raises ORGII_CONFLICT. */
  expectedEpoch: number;
  expectedFrozenSeq: number;
  /** New frozen segments (may be empty for a tail-only replace). */
  frozenSegments: SessionEventsSegmentInput[];
  /** Replacement tail events; null deletes the tail (fully frozen stream). */
  tail: SessionEvent[] | null;
  totalCount: number;
}

export interface RewriteSessionEventsInput extends CollabSyncProfile {
  orgId: string;
  sessionRowId: string;
  /** Must be greater than the server's current epoch. */
  newEpoch: number;
  frozenSegments: SessionEventsSegmentInput[];
  tail: SessionEvent[] | null;
  totalCount: number;
}

export interface GetSessionEventSegmentsInput extends CollabSyncProfile {
  orgId: string;
  sessionRowId: string;
  /** Return frozen segments with seq strictly greater; tail always included. */
  afterSeq?: number;
}

export interface SessionEventSegmentRecord {
  seq: number;
  isTail: boolean;
  events: SessionEvent[];
  eventCount: number;
  segmentHash: string;
}

/** Single-statement snapshot of the summary + requested segments. */
export interface SessionEventSegmentsSnapshot {
  /** null ⇒ the owner has never pushed segments for this session. */
  epoch: number | null;
  frozenSeq: number | null;
  tailHash: string | null;
  count: number | null;
  segments: SessionEventSegmentRecord[];
}

export interface GcSessionEventSegmentsInput extends CollabSyncProfile {
  orgId: string;
  /** Defaults to the server-side 90-day retention (design §7.5). */
  retentionDays?: number;
}

export interface UpdateOrgRepoScopesInput extends CollabSyncProfile {
  orgId: string;
  repoScopes: string[];
}

export interface RequestRepoJoinInput extends CollabSyncProfile {
  orgId: string;
  repoPath: string;
  requesterMemberId: string;
}

export interface ReviewRepoJoinInput extends CollabSyncProfile {
  orgId: string;
  requestId: string;
  approve: boolean;
  reviewNote?: string;
}

export interface CollabOrgState {
  serverTime?: string;
  orgs: CollabOrgRecord[];
  members: CollabMemberRecord[];
  invites: CollabInviteRecord[];
  projects: CollabProjectMetadataRecord[];
  workItems: CollabWorkItemMetadataRecord[];
  sessions: RemoteTeammateSessionMetadata[];
  chatMessages: CollabChatMessageRecord[];
  repoJoinRequests: CollabRepoJoinRequestRecord[];
  snapshotRequests: Array<{
    requestId: string;
    orgId: string;
    requesterMemberId: string;
    ownerMemberId: string;
    sourceSessionId: string;
    status: "pending" | "sent" | "denied" | "completed" | "failed";
    error?: string;
    createdAt: string;
    updatedAt?: string;
    session?: RemoteTeammateSessionMetadata;
    events?: SessionEvent[];
  }>;
}

export interface VerifySetupInput extends CollabSyncProfile {}

export interface VerifySetupResult {
  ok: boolean;
  schemaVersion?: number;
  missing?: string[];
}

export interface CollabSyncBackendClient {
  verifySetup(input: VerifySetupInput): Promise<VerifySetupResult>;
  createOrg(
    input: CreateOrgInput
  ): Promise<{ org: CollabOrgRecord; member: CollabMemberRecord }>;
  acceptInvite(
    input: AcceptInviteInput
  ): Promise<{ org: CollabOrgRecord; member: CollabMemberRecord }>;
  createInvite(input: CreateInviteInput): Promise<CollabInviteRecord>;
  revokeInvite(input: RevokeInviteInput): Promise<void>;
  updateMemberRole(input: UpdateMemberRoleInput): Promise<void>;
  removeMember(input: RemoveMemberInput): Promise<CollabMemberRecord>;
  listChatMessages(
    input: ListChatMessagesInput
  ): Promise<CollabChatMessageRecord[]>;
  postChatMessage(
    input: PostChatMessageInput
  ): Promise<CollabChatMessageRecord>;
  upsertProjectMetadata(input: UpsertProjectMetadataInput): Promise<void>;
  upsertWorkItem(input: UpsertWorkItemInput): Promise<void>;
  upsertSessionMetadata(input: UpsertSessionMetadataInput): Promise<void>;
  removeSessionMetadata(input: RemoveSessionMetadataInput): Promise<void>;
  appendSessionEvents(input: AppendSessionEventsInput): Promise<void>;
  rewriteSessionEvents(input: RewriteSessionEventsInput): Promise<void>;
  getSessionEventSegments(
    input: GetSessionEventSegmentsInput
  ): Promise<SessionEventSegmentsSnapshot>;
  /** Returns the number of segment rows removed by the retention sweep. */
  gcSessionEventSegments(input: GcSessionEventSegmentsInput): Promise<number>;
  updateOrgRepoScopes(input: UpdateOrgRepoScopesInput): Promise<void>;
  requestRepoJoin(input: RequestRepoJoinInput): Promise<void>;
  reviewRepoJoin(input: ReviewRepoJoinInput): Promise<void>;
  requestSessionSnapshot(input: RequestSessionSnapshotInput): Promise<void>;
  publishSessionSnapshot(input: PublishSessionSnapshotInput): Promise<void>;
  denySessionSnapshot(input: DenySessionSnapshotInput): Promise<void>;
  listOrgState(input: ListOrgStateInput): Promise<CollabOrgState>;
}
