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
  SessionEventsRef,
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
  reviewerMemberId: z.string().optional(),
  reviewNote: z.string().optional(),
  createdAt: z.string(),
  reviewedAt: z.string().optional(),
});

const SessionEventsRefSchema = z.object({
  blobPath: z.string().nullable(),
  contentHash: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const SessionEventsBlobSchema = z.object({
  events: z.array(z.custom<SessionEvent>()),
});

const OrgStateSchema = z.object({
  orgs: z.array(CollabOrgRecordSchema).default([]),
  members: z.array(CollabMemberRecordSchema).default([]),
  invites: z.array(JsonRecordSchema).default([]),
  projects: z.array(JsonRecordSchema).default([]),
  workItems: z.array(JsonRecordSchema).default([]),
  sessions: z.array(RemoteTeammateSessionMetadataSchema).default([]),
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

function requireOrgSecret(profile: CollabSyncProfile): string {
  const secret = profile.orgSecret?.trim();
  if (!secret) throw new Error("ORG sync secret is required");
  return secret;
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
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function createOrgPayload(
  input: CreateOrgInput,
  orgId: string,
  orgSecret: string,
  localMemberId: string
): CollabOrgRecord {
  return {
    id: orgId,
    name: input.name,
    syncBackend: COLLAB_SYNC_BACKEND.SUPABASE,
    supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
    supabaseAnonKey: input.anonKey,
    orgSecret,
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
    inviteCode: String(payload.inviteCode),
    inviteLink: String(payload.inviteLink),
    usageLimit: Number(payload.usageLimit ?? 10),
    usageCount: Number(payload.usageCount ?? 0),
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
      return {
        ok: schemaVersion === SUPABASE_SYNC_SCHEMA_VERSION,
        schemaVersion: schemaVersion ?? undefined,
        missing:
          schemaVersion === SUPABASE_SYNC_SCHEMA_VERSION
            ? []
            : ["orgii_sync_version"],
      };
    } catch {
      return { ok: false, missing: ["orgii_sync_version"] };
    }
  },

  async createOrg(input: CreateOrgInput) {
    const orgId = createId("org");
    const orgSecret = input.orgSecret?.trim() || createOrgSecret();
    const member = createMemberPayload(input, orgId, COLLAB_ROLE.ADMIN);
    const org = createOrgPayload(input, orgId, orgSecret, member.id);
    return callRpc(
      input,
      "orgii_create_org",
      {
        org_name: input.name,
        display_name: input.displayName,
        identity_kind: input.identityKind,
        org_secret_hash: await sha256Hex(orgSecret),
        payload: org,
        member_payload: member,
      },
      CreateOrgResponseSchema
    );
  },

  async acceptInvite(input: AcceptInviteInput) {
    const parsedOrgId = "pending";
    const member = createMemberPayload(input, parsedOrgId, COLLAB_ROLE.MEMBER);
    const result = await callRpc(
      input,
      "orgii_accept_invite",
      {
        invite_code: input.inviteCode,
        display_name: input.displayName,
        identity_kind: input.identityKind,
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
        orgSecret: input.inviteCode,
        localMemberId: result.member.id,
      },
      member: result.member,
    };
  },

  async createInvite(input: CreateInviteInput): Promise<CollabInviteRecord> {
    const inviteCode = createOrgSecret();
    const invite: CollabInviteRecord = {
      id: createId("invite"),
      orgId: input.orgId,
      supabaseUrl: normalizeSupabaseProjectUrl(input.supabaseUrl),
      supabaseAnonKey: input.anonKey,
      inviteCode,
      inviteLink: buildCollabInviteLink({
        supabaseUrl: input.supabaseUrl,
        anonKey: input.anonKey,
        inviteCode,
      }),
      usageLimit: input.usageLimit ?? 10,
      usageCount: 0,
      expiresAt: input.expiresAt,
      createdAt: new Date().toISOString(),
    };
    await callRpc(
      input,
      "orgii_create_invite",
      {
        org_secret: requireOrgSecret(input),
        org_id: input.orgId,
        invite_code_hash: await sha256Hex(inviteCode),
        usage_limit: invite.usageLimit,
        expires_at: input.expiresAt ?? null,
        payload: invite,
      },
      JsonRecordSchema
    );
    return invite;
  },

  async removeMember(input: RemoveMemberInput): Promise<CollabMemberRecord> {
    return callRpc(
      input,
      "orgii_remove_member",
      {
        org_secret: requireOrgSecret(input),
        org_id: input.orgId,
        member_id: input.memberId,
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
    const payload = createChatMessagePayload(input);
    return callRpc(
      input,
      "orgii_post_chat_message",
      {
        org_secret: requireOrgSecret(input),
        payload,
      },
      CollabChatMessageRecordSchema
    );
  },

  async upsertProjectMetadata(
    input: UpsertProjectMetadataInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_upsert_project", {
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
      payload: input.project,
    });
  },

  async upsertWorkItem(input: UpsertWorkItemInput): Promise<void> {
    await callRpcVoid(input, "orgii_upsert_work_item", {
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
      payload: input.workItem,
    });
  },

  async upsertSessionMetadata(
    input: UpsertSessionMetadataInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_upsert_session_metadata", {
      org_secret: requireOrgSecret(input),
      payload: input.session,
    });
  },

  async removeSessionMetadata(
    input: RemoveSessionMetadataInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_remove_session_metadata", {
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
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
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
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
        org_secret: requireOrgSecret(input),
        org_id: input.orgId,
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
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
      repo_scopes: input.repoScopes,
    });
  },

  async requestRepoJoin(input: RequestRepoJoinInput): Promise<void> {
    const requestId = createId("repo-join");
    await callRpcVoid(input, "orgii_request_repo_join", {
      org_secret: requireOrgSecret(input),
      org_id: input.orgId,
      repo_path: input.repoPath,
      requester_member_id: input.requesterMemberId,
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
    await callRpcVoid(input, "orgii_review_repo_join", {
      org_secret: requireOrgSecret(input),
      request_id: input.requestId,
      approve: input.approve,
      reviewer_member_id: input.reviewerMemberId,
      review_note: input.reviewNote ?? null,
    });
  },

  async requestSessionSnapshot(
    input: RequestSessionSnapshotInput
  ): Promise<void> {
    await callRpcVoid(input, "orgii_request_session_snapshot", {
      org_secret: requireOrgSecret(input),
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
      org_secret: requireOrgSecret(input),
      request_id: input.requestId,
      org_id: input.orgId,
      source_session_id: input.sourceSessionId,
      metadata: input.session,
      blob_path: blobPath,
      content_hash: contentHash,
    });
  },

  async denySessionSnapshot(input: DenySessionSnapshotInput): Promise<void> {
    await callRpcVoid(input, "orgii_deny_session_snapshot", {
      org_secret: requireOrgSecret(input),
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
          org_secret: requireOrgSecret(input),
          org_id: input.orgId,
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
