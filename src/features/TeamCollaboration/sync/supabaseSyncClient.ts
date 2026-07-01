import { z } from "zod/v4";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  CollabChatMessageRecordSchema,
  CollabMemberRecordSchema,
  CollabOrgRecordSchema,
  RemoteTeammateSessionMetadataSchema,
  buildCollabInviteLink,
  createCollabAvatarIdentity,
  normalizeSupabaseProjectUrl,
} from "@src/store/collaboration/protocol";
import {
  COLLAB_IDENTITY_KIND,
  COLLAB_REPO_JOIN_STATUS,
  COLLAB_ROLE,
  COLLAB_SYNC_BACKEND,
  SUPABASE_SESSION_SNAPSHOT_BUCKET,
  SUPABASE_SYNC_SCHEMA_VERSION,
} from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
  CollabRole,
} from "@src/store/collaboration/types";

import type {
  AcceptInviteInput,
  CollabOrgState,
  CollabSyncBackendClient,
  CollabSyncProfile,
  CreateInviteInput,
  CreateOrgInput,
  DenySessionSnapshotInput,
  DownloadSessionEventsBlobInput,
  GetSessionEventsInput,
  ListChatMessagesInput,
  ListOrgStateInput,
  PostChatMessageInput,
  PublishSessionSnapshotInput,
  RemoveMemberInput,
  RemoveSessionMetadataInput,
  RequestRepoJoinInput,
  RequestSessionSnapshotInput,
  ReviewRepoJoinInput,
  RevokeInviteInput,
  SessionEventsRef,
  UpdateMemberRoleInput,
  UpdateOrgRepoScopesInput,
  UpsertProjectMetadataInput,
  UpsertSessionEventsInput,
  UpsertSessionMetadataInput,
  UpsertWorkItemInput,
  VerifySetupInput,
  VerifySetupResult,
} from "./CollabSyncBackend";

const JsonRecordSchema = z.record(z.string(), z.unknown());

const CreateOrgResponseSchema = z.object({
  org: CollabOrgRecordSchema,
  member: CollabMemberRecordSchema,
});

const AcceptInviteResponseSchema = CreateOrgResponseSchema;

const RepoJoinRequestSchema = z.object({
  requestId: z.string(),
  orgId: z.string(),
  requesterMemberId: z.string(),
  repoPath: z.string(),
  status: z.enum([
    COLLAB_REPO_JOIN_STATUS.PENDING,
    COLLAB_REPO_JOIN_STATUS.APPROVED,
    COLLAB_REPO_JOIN_STATUS.REJECTED,
  ]),
  reviewerMemberId: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  reviewNote: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  createdAt: z.string(),
  reviewedAt: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});

const SessionEventsRefSchema = z.object({
  blobPath: z.string().nullable(),
  contentHash: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const SessionEventsBlobSchema = z.object({
  events: z.array(z.custom<SessionEvent>()),
});

// Tombstoned session rows carry a stripped payload ({id, orgId,
// ownerMemberId, sourceSessionId, deletedAt}); backfill the display fields the
// full schema requires — tombstones are removed from local state immediately,
// so the placeholders never render.
const RemoteSessionWireSchema = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.deletedAt === "string" && record.deletedAt) {
      return {
        ownerUserId: record.ownerMemberId ?? "",
        ownerDisplayName: "",
        ownerIdentityKind: COLLAB_IDENTITY_KIND.HUMAN,
        title: "",
        ...record,
      };
    }
  }
  return value;
}, RemoteTeammateSessionMetadataSchema);

const OrgStateSchema = z.object({
  serverTime: z.string().optional(),
  orgs: z.array(CollabOrgRecordSchema).default([]),
  members: z.array(CollabMemberRecordSchema).default([]),
  invites: z.array(JsonRecordSchema).default([]),
  projects: z.array(JsonRecordSchema).default([]),
  workItems: z.array(JsonRecordSchema).default([]),
  sessions: z.array(RemoteSessionWireSchema).default([]),
  chatMessages: z.array(CollabChatMessageRecordSchema).default([]),
  repoJoinRequests: z.array(RepoJoinRequestSchema).default([]),
  snapshotRequests: z.array(JsonRecordSchema).default([]),
});

const SnapshotBlobSchema = z.object({
  session: RemoteTeammateSessionMetadataSchema,
  events: z.array(z.custom<SessionEvent>()),
});

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// PostgREST matches RPCs on the exact body key set, so auth params must be
// spread as-is and nothing else credential-shaped may leak onto the wire.
function memberAuthParams(profile: CollabSyncProfile): {
  p_member_id: string;
  p_member_token: string;
} {
  const memberId = profile.memberId?.trim();
  const memberToken = profile.memberToken?.trim();
  if (!memberId || !memberToken) {
    throw new Error("ORGII member credential required");
  }
  return { p_member_id: memberId, p_member_token: memberToken };
}

function flexAuthParams(
  profile: CollabSyncProfile
): { p_member_id: string; p_member_token: string } | { p_org_secret: string } {
  const memberId = profile.memberId?.trim();
  const memberToken = profile.memberToken?.trim();
  if (memberId && memberToken) {
    return { p_member_id: memberId, p_member_token: memberToken };
  }
  const orgSecret = profile.orgSecret?.trim();
  if (orgSecret) return { p_org_secret: orgSecret };
  throw new Error("ORGII sync credential required");
}

function supabaseHeaders(anonKey: string, contentType = true): HeadersInit {
  return {
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

function rpcUrl(profile: CollabSyncProfile, functionName: string): string {
  return `${normalizeSupabaseProjectUrl(profile.supabaseUrl)}/rest/v1/rpc/${functionName}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : `Supabase request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function callRpc<T>(
  profile: CollabSyncProfile,
  functionName: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<T> {
  const response = await fetch(rpcUrl(profile, functionName), {
    method: "POST",
    headers: supabaseHeaders(profile.anonKey),
    body: JSON.stringify(body),
  });
  return schema.parse(await parseJsonResponse(response));
}

async function callRpcVoid(
  profile: CollabSyncProfile,
  functionName: string,
  body: Record<string, unknown>
): Promise<void> {
  const response = await fetch(rpcUrl(profile, functionName), {
    method: "POST",
    headers: supabaseHeaders(profile.anonKey),
    body: JSON.stringify(body),
  });
  await parseJsonResponse(response);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function createOrgSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function createOrgPayload(
  input: CreateOrgInput,
  orgId: string,
  orgSecret: string,
  memberToken: string,
  localMemberId: string
): CollabOrgRecord {
  return {
    id: orgId,
    name: input.name,
    syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
    supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
    supabaseAnonKey: input.anonKey,
    orgSecret,
    memberToken,
    groupId: orgId,
    localMemberId,
    createdAt: new Date().toISOString(),
  };
}

function createMemberPayload(
  input: Pick<
    CreateOrgInput | AcceptInviteInput,
    "displayName" | "identityKind"
  >,
  orgId: string,
  role: CollabMemberRecord["role"]
): CollabMemberRecord {
  const memberId = createId("member");
  return {
    id: memberId,
    orgId,
    displayName: input.displayName,
    avatar: createCollabAvatarIdentity(input.displayName),
    role,
    identityKind: input.identityKind,
    joinedAt: new Date().toISOString(),
  };
}

function createChatMessagePayload(
  input: PostChatMessageInput
): CollabChatMessageRecord {
  return {
    id: createId("chat"),
    orgId: input.orgId,
    authorMemberId: input.memberId,
    authorDisplayName: input.authorDisplayName,
    authorIdentityKind: input.authorIdentityKind,
    body: input.body,
    createdAt: new Date().toISOString(),
  };
}

function normalizeInviteRole(value: unknown): CollabRole | undefined {
  return value === COLLAB_ROLE.ADMIN || value === COLLAB_ROLE.MEMBER
    ? value
    : undefined;
}

function normalizeInviteRecord(
  payload: z.infer<typeof JsonRecordSchema>
): CollabInviteRecord {
  return {
    id: String(payload.id),
    orgId: String(payload.orgId),
    supabaseUrl:
      typeof payload.supabaseUrl === "string" ? payload.supabaseUrl : undefined,
    supabaseAnonKey:
      typeof payload.supabaseAnonKey === "string"
        ? payload.supabaseAnonKey
        : undefined,
    inviteCode:
      typeof payload.inviteCode === "string" ? payload.inviteCode : undefined,
    inviteLink:
      typeof payload.inviteLink === "string" ? payload.inviteLink : undefined,
    usageLimit: Number(payload.usageLimit ?? 10),
    usageCount: Number(payload.usageCount ?? 0),
    role: normalizeInviteRole(payload.role),
    codeSuffix:
      typeof payload.codeSuffix === "string" ? payload.codeSuffix : undefined,
    createdByMemberId:
      typeof payload.createdByMemberId === "string"
        ? payload.createdByMemberId
        : undefined,
    expiresAt:
      typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
    createdAt:
      typeof payload.createdAt === "string"
        ? payload.createdAt
        : new Date().toISOString(),
    revokedAt:
      typeof payload.revokedAt === "string" ? payload.revokedAt : undefined,
  };
}

async function uploadSnapshotBlob(
  profile: CollabSyncProfile,
  blobPath: string,
  body: unknown
): Promise<void> {
  const response = await fetch(
    `${normalizeSupabaseProjectUrl(profile.supabaseUrl)}/storage/v1/object/${SUPABASE_SESSION_SNAPSHOT_BUCKET}/${blobPath}`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(profile.anonKey, false),
        "content-type": "application/json",
        "x-upsert": "true",
      },
      body: JSON.stringify(body),
    }
  );
  await parseJsonResponse(response);
}

async function downloadSnapshotBlob(
  profile: CollabSyncProfile,
  blobPath: string
): Promise<z.infer<typeof SnapshotBlobSchema>> {
  const response = await fetch(
    `${normalizeSupabaseProjectUrl(profile.supabaseUrl)}/storage/v1/object/${SUPABASE_SESSION_SNAPSHOT_BUCKET}/${blobPath}`,
    { headers: supabaseHeaders(profile.anonKey, false) }
  );
  return SnapshotBlobSchema.parse(await parseJsonResponse(response));
}

async function downloadSessionEventsBlob(
  profile: CollabSyncProfile,
  blobPath: string
): Promise<SessionEvent[]> {
  const response = await fetch(
    `${normalizeSupabaseProjectUrl(profile.supabaseUrl)}/storage/v1/object/${SUPABASE_SESSION_SNAPSHOT_BUCKET}/${blobPath}`,
    { headers: supabaseHeaders(profile.anonKey, false) }
  );
  const parsed = SessionEventsBlobSchema.parse(
    await parseJsonResponse(response)
  );
  return parsed.events;
}

export const supabaseSyncClient: CollabSyncBackendClient = {
  async verifySetup(input: VerifySetupInput): Promise<VerifySetupResult> {
    try {
      const schemaVersion = await callRpc(
        input,
        "orgii_sync_version",
        {},
        z.number().nullable()
      );
      // The server may run a newer schema than this client understands.
      const ok =
        typeof schemaVersion === "number" &&
        schemaVersion >= SUPABASE_SYNC_SCHEMA_VERSION;
      return {
        ok,
        schemaVersion: schemaVersion ?? undefined,
        missing: ok ? [] : ["orgii_sync_version"],
      };
    } catch {
      return { ok: false, missing: ["orgii_sync_version"] };
    }
  },

  async createOrg(input: CreateOrgInput) {
    const orgId = createId("org");
    const orgSecret = input.orgSecret?.trim() || createOrgSecret();
    const memberToken = createOrgSecret();
    const member = createMemberPayload(input, orgId, COLLAB_ROLE.ADMIN);
    const org = createOrgPayload(
      input,
      orgId,
      orgSecret,
      memberToken,
      member.id
    );
    // Secrets never go on the wire — the server persists this payload and
    // serves it back to every member through list_org_state.
    const {
      orgSecret: _orgSecret,
      supabaseAnonKey: _supabaseAnonKey,
      memberToken: _memberToken,
      ...wireOrgPayload
    } = org;
    const result = await callRpc(
      input,
      "orgii_create_org",
      {
        org_name: input.name,
        display_name: input.displayName,
        identity_kind: input.identityKind,
        org_secret_hash: await sha256Hex(orgSecret),
        member_credential_hash: await sha256Hex(memberToken),
        payload: wireOrgPayload,
        member_payload: member,
      },
      CreateOrgResponseSchema
    );
    return {
      org: {
        ...result.org,
        syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
        supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
        supabaseAnonKey: input.anonKey,
        orgSecret,
        memberToken,
        localMemberId: result.member.id,
      },
      member: result.member,
    };
  },

  async acceptInvite(input: AcceptInviteInput) {
    const parsedOrgId = "pending";
    const memberToken = createOrgSecret();
    const member = createMemberPayload(input, parsedOrgId, COLLAB_ROLE.MEMBER);
    const result = await callRpc(
      input,
      "orgii_accept_invite",
      {
        invite_code: input.inviteCode,
        display_name: input.displayName,
        identity_kind: input.identityKind,
        member_credential_hash: await sha256Hex(memberToken),
        member_payload: member,
      },
      AcceptInviteResponseSchema
    );
    return {
      org: {
        ...result.org,
        syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
        supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
        supabaseAnonKey: input.anonKey,
        // Joiners never hold the root secret; the member token is their
        // credential.
        orgSecret: undefined,
        memberToken,
        localMemberId: result.member.id,
      },
      member: result.member,
    };
  },

  async createInvite(input: CreateInviteInput): Promise<CollabInviteRecord> {
    const inviteCode = createOrgSecret();
    const role = input.role ?? COLLAB_ROLE.MEMBER;
    // Wire payload is display metadata only; the plaintext code exists solely
    // on this client.
    const wirePayload = {
      id: createId("invite"),
      orgId: input.orgId,
      codeSuffix: inviteCode.slice(-4),
      usageLimit: input.usageLimit ?? 10,
      usageCount: 0,
      role,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    await callRpc(
      input,
      "orgii_create_invite",
      {
        p_org_id: input.orgId,
        ...flexAuthParams(input),
        invite_code_hash: await sha256Hex(inviteCode),
        usage_limit: wirePayload.usageLimit,
        expires_at: input.expiresAt ?? null,
        invite_role: role,
        payload: wirePayload,
      },
      JsonRecordSchema
    );
    return {
      ...wirePayload,
      supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
      supabaseAnonKey: input.anonKey,
      createdByMemberId: input.memberId,
      inviteCode,
      inviteLink: buildCollabInviteLink({
        supabaseUrl: input.supabaseUrl,
        anonKey: input.anonKey,
        inviteCode,
      }),
    };
  },

  async revokeInvite(input: RevokeInviteInput): Promise<void> {
    await callRpcVoid(input, "orgii_revoke_invite", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      invite_id: input.inviteId,
    });
  },

  async updateMemberRole(input: UpdateMemberRoleInput): Promise<void> {
    await callRpcVoid(input, "orgii_update_member_role", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      target_member_id: input.targetMemberId,
      new_role: input.role,
    });
  },

  async removeMember(input: RemoveMemberInput): Promise<CollabMemberRecord> {
    return callRpc(
      input,
      "orgii_remove_member",
      {
        p_org_id: input.orgId,
        ...flexAuthParams(input),
        target_member_id: input.targetMemberId,
      },
      CollabMemberRecordSchema
    );
  },

  async listChatMessages(
    input: ListChatMessagesInput
  ): Promise<CollabChatMessageRecord[]> {
    const state = await this.listOrgState(input);
    return input.limit
      ? state.chatMessages.slice(-input.limit)
      : state.chatMessages;
  },

  async postChatMessage(
    input: PostChatMessageInput
  ): Promise<CollabChatMessageRecord> {
    // Server forces authorMemberId to the authenticated member regardless.
    const payload = createChatMessagePayload(input);
    return callRpc(
      input,
      "orgii_post_chat_message",
      {
        p_org_id: input.orgId,
        ...memberAuthParams(input),
        payload,
      },
      CollabChatMessageRecordSchema
    );
  },

  async upsertProjectMetadata(
    input: UpsertProjectMetadataInput
  ): Promise<void> {
    const projectVersion = input.project.version;
    await callRpcVoid(input, "orgii_upsert_project", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      project: input.project,
      base_version:
        input.baseVersion ??
        (typeof projectVersion === "number" ? projectVersion : null),
    });
  },

  async upsertWorkItem(input: UpsertWorkItemInput): Promise<void> {
    const workItemVersion = input.workItem.version;
    await callRpcVoid(input, "orgii_upsert_work_item", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      work_item: input.workItem,
      base_version:
        input.baseVersion ??
        (typeof workItemVersion === "number" ? workItemVersion : null),
    });
  },

  async upsertSessionMetadata(
    input: UpsertSessionMetadataInput
  ): Promise<void> {
    // Member-only RPC: the function has no p_org_secret parameter, and
    // PostgREST rejects bodies with unknown keys.
    await callRpcVoid(input, "orgii_upsert_session_metadata", {
      p_org_id: input.session.orgId,
      ...memberAuthParams(input),
      payload: input.session,
    });
  },

  async removeSessionMetadata(
    input: RemoveSessionMetadataInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_remove_session_metadata", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      owner_member_id: input.ownerMemberId,
      source_session_id: input.sourceSessionId,
    });
  },

  async upsertSessionEvents(input: UpsertSessionEventsInput): Promise<void> {
    const body = { events: input.events };
    const serialized = JSON.stringify(body);
    const contentHash = await sha256Hex(serialized);
    const blobPath = `orgs/${input.orgId}/sessions/${input.sourceSessionId}/latest-${contentHash}.json`;
    await uploadSnapshotBlob(input, blobPath, body);
    await callRpcVoid(input, "orgii_upsert_session_events", {
      p_org_id: input.orgId,
      ...memberAuthParams(input),
      source_session_id: input.sourceSessionId,
      blob_path: blobPath,
      content_hash: contentHash,
    });
  },

  async getSessionEvents(
    input: GetSessionEventsInput
  ): Promise<SessionEventsRef | null> {
    const raw = await callRpc(
      input,
      "orgii_get_session_events",
      {
        p_org_id: input.orgId,
        ...flexAuthParams(input),
        source_session_id: input.sourceSessionId,
      },
      SessionEventsRefSchema.nullable()
    );
    if (!raw || !raw.blobPath || !raw.contentHash || !raw.updatedAt) {
      return null;
    }
    return {
      blobPath: raw.blobPath,
      contentHash: raw.contentHash,
      updatedAt: raw.updatedAt,
    };
  },

  async downloadSessionEventsBlob(
    input: DownloadSessionEventsBlobInput
  ): Promise<SessionEvent[]> {
    return downloadSessionEventsBlob(input, input.blobPath);
  },

  async updateOrgRepoScopes(input: UpdateOrgRepoScopesInput): Promise<void> {
    await callRpcVoid(input, "orgii_update_org_repo_scopes", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      repo_scopes: input.repoScopes,
    });
  },

  async requestRepoJoin(input: RequestRepoJoinInput): Promise<void> {
    const requestId = createId("repo-join");
    // requesterMemberId stays in the payload for display; the server forces
    // it to the authenticated member.
    await callRpcVoid(input, "orgii_request_repo_join", {
      p_org_id: input.orgId,
      ...memberAuthParams(input),
      repo_path: input.repoPath,
      payload: {
        requestId,
        orgId: input.orgId,
        requesterMemberId: input.requesterMemberId,
        repoPath: input.repoPath,
        status: COLLAB_REPO_JOIN_STATUS.PENDING,
        createdAt: new Date().toISOString(),
      },
    });
  },

  async reviewRepoJoin(input: ReviewRepoJoinInput): Promise<void> {
    // reviewer_member_id is no longer sent: the server records the
    // authenticated reviewer itself.
    await callRpcVoid(input, "orgii_review_repo_join", {
      p_org_id: input.orgId,
      ...flexAuthParams(input),
      request_id: input.requestId,
      approve: input.approve,
      review_note: input.reviewNote ?? null,
    });
  },

  async requestSessionSnapshot(
    input: RequestSessionSnapshotInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_request_session_snapshot", {
      p_org_id: input.orgId,
      ...memberAuthParams(input),
      payload: {
        requestId: input.requestId,
        orgId: input.orgId,
        requesterMemberId: input.requesterMemberId,
        ownerMemberId: input.ownerMemberId,
        sourceSessionId: input.sourceSessionId,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    });
  },

  async publishSessionSnapshot(
    input: PublishSessionSnapshotInput
  ): Promise<void> {
    const body = { session: input.session, events: input.events };
    const serialized = JSON.stringify(body);
    const contentHash = await sha256Hex(serialized);
    const blobPath = `orgs/${input.orgId}/sessions/${input.sourceSessionId}/${input.requestId}-${contentHash}.json`;
    await uploadSnapshotBlob(input, blobPath, body);
    await callRpcVoid(input, "orgii_create_session_snapshot", {
      p_org_id: input.orgId,
      ...memberAuthParams(input),
      request_id: input.requestId,
      source_session_id: input.sourceSessionId,
      metadata: input.session,
      blob_path: blobPath,
      content_hash: contentHash,
    });
  },

  async denySessionSnapshot(input: DenySessionSnapshotInput): Promise<void> {
    await callRpcVoid(input, "orgii_deny_session_snapshot", {
      p_org_id: input.orgId,
      ...memberAuthParams(input),
      request_id: input.requestId,
      reason: input.reason,
    });
  },

  async listOrgState(input: ListOrgStateInput): Promise<CollabOrgState> {
    const parsed = OrgStateSchema.parse(
      await callRpc(
        input,
        "orgii_list_org_state",
        {
          p_org_id: input.orgId,
          ...flexAuthParams(input),
          since_timestamp: input.sinceTimestamp ?? null,
        },
        JsonRecordSchema
      )
    );
    const snapshotRequests = await Promise.all(
      parsed.snapshotRequests.map(async (request) => {
        const blobPath =
          typeof request.blobPath === "string" ? request.blobPath : undefined;
        if (!blobPath) return request;
        const snapshot = await downloadSnapshotBlob(input, blobPath);
        return {
          ...request,
          session: snapshot.session,
          events: snapshot.events,
        };
      })
    );
    return {
      serverTime: parsed.serverTime,
      orgs: parsed.orgs,
      members: parsed.members,
      invites: parsed.invites.map(normalizeInviteRecord),
      projects: parsed.projects,
      workItems: parsed.workItems,
      sessions: parsed.sessions,
      chatMessages: parsed.chatMessages,
      repoJoinRequests: parsed.repoJoinRequests,
      snapshotRequests: snapshotRequests.map((request) => ({
        requestId: String(request.requestId),
        orgId: String(request.orgId),
        requesterMemberId: String(request.requesterMemberId),
        ownerMemberId: String(request.ownerMemberId),
        sourceSessionId: String(request.sourceSessionId),
        status: String(request.status) as
          | "pending"
          | "sent"
          | "denied"
          | "completed"
          | "failed",
        error: typeof request.error === "string" ? request.error : undefined,
        createdAt:
          typeof request.createdAt === "string"
            ? request.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof request.updatedAt === "string" ? request.updatedAt : undefined,
        session:
          "session" in request
            ? RemoteTeammateSessionMetadataSchema.optional().parse(
                request.session
              )
            : undefined,
        events:
          "events" in request
            ? z.array(z.custom<SessionEvent>()).parse(request.events)
            : undefined,
      })),
    };
  },
};
