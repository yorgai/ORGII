import { z } from "zod/v4";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  COLLAB_IDENTITY_KIND,
  COLLAB_REPO_JOIN_STATUS,
  COLLAB_ROLE,
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_SYNC_BACKEND,
  COLLAB_WORKSPACE_SCOPE,
  type CollabAvatarIdentity,
  type CollabChatMessageRecord,
  type CollabIdentityKind,
  type CollabMemberRecord,
  type CollabOrgRecord,
  type CollabRepoJoinRequestRecord,
  type CollabRepoJoinStatus,
  type CollabRole,
  type CollabSessionAccessMode,
  type CollabSessionAccessSettings,
  type CollabSyncBackend,
  type CollabWorkspaceScope,
  type RemoteTeammateSessionMetadata,
  SUPABASE_SYNC_SCHEMA_VERSION,
  type SupabaseSyncProfile,
} from "./types";

export const COLLAB_PROTOCOL_VERSION = 1;

export const COLLAB_MESSAGE_TYPE = {
  PRESENCE_UPDATE: "presence.update",
  SESSION_METADATA_UPSERT: "session.metadata.upsert",
  SESSION_METADATA_REMOVE: "session.metadata.remove",
  SESSION_SNAPSHOT_REQUEST: "session.snapshot.request",
  SESSION_SNAPSHOT_RESPONSE: "session.snapshot.response",
  SESSION_SNAPSHOT_DENIED: "session.snapshot.denied",
  CHAT_MESSAGE: "chat.message",
} as const;

export type CollabMessageType =
  (typeof COLLAB_MESSAGE_TYPE)[keyof typeof COLLAB_MESSAGE_TYPE];

export const CollabRoleSchema = z.enum([
  COLLAB_ROLE.ADMIN,
  COLLAB_ROLE.MEMBER,
] satisfies [CollabRole, CollabRole]);

export const CollabIdentityKindSchema = z.enum([
  COLLAB_IDENTITY_KIND.HUMAN,
  COLLAB_IDENTITY_KIND.AGENT,
] satisfies [CollabIdentityKind, CollabIdentityKind]);

export const CollabSessionAccessModeSchema = z.enum([
  COLLAB_SESSION_ACCESS_MODE.OFF,
  COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
  COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
] satisfies [
  CollabSessionAccessMode,
  CollabSessionAccessMode,
  CollabSessionAccessMode,
]);

export const CollabWorkspaceScopeSchema = z.enum([
  COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
] satisfies [CollabWorkspaceScope]);

export const CollabSessionAccessSettingsSchema = z.object({
  orgId: z.string(),
  memberId: z.string(),
  accessMode: CollabSessionAccessModeSchema,
  workspaceScope: CollabWorkspaceScopeSchema,
  workspacePaths: z.array(z.string()),
  updatedAt: z.string(),
}) satisfies z.ZodType<CollabSessionAccessSettings>;

export const CollabRepoJoinRequestRecordSchema = z.object({
  requestId: z.string(),
  orgId: z.string(),
  requesterMemberId: z.string(),
  repoPath: z.string(),
  status: z.enum([
    COLLAB_REPO_JOIN_STATUS.PENDING,
    COLLAB_REPO_JOIN_STATUS.APPROVED,
    COLLAB_REPO_JOIN_STATUS.REJECTED,
  ] satisfies [
    CollabRepoJoinStatus,
    CollabRepoJoinStatus,
    CollabRepoJoinStatus,
  ]),
  reviewerMemberId: z.string().optional(),
  reviewNote: z.string().optional(),
  createdAt: z.string(),
  reviewedAt: z.string().optional(),
}) satisfies z.ZodType<CollabRepoJoinRequestRecord>;

export const CollabSyncBackendSchema = z.enum([
  COLLAB_SYNC_BACKEND.SUPABASE,
] satisfies [CollabSyncBackend]);

export const SupabaseSyncProfileSchema = z.object({
  backend: z.literal(COLLAB_SYNC_BACKEND.SUPABASE),
  supabaseUrl: z.string(),
  anonKey: z.string(),
  orgSecret: z.string(),
  schemaVersion: z.literal(SUPABASE_SYNC_SCHEMA_VERSION),
}) satisfies z.ZodType<SupabaseSyncProfile>;

export const CollabAvatarIdentitySchema = z.object({
  initials: z.string(),
  variant: z.string(),
}) satisfies z.ZodType<CollabAvatarIdentity>;

export const CollabOrgRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectOrgId: z.string().optional(),
  syncBackend: CollabSyncBackendSchema.optional(),
  supabaseUrl: z.string().optional(),
  supabaseAnonKey: z.string().optional(),
  orgSecret: z.string().optional(),
  groupId: z.string().optional(),
  adminMemberId: z.string().optional(),
  localMemberId: z.string().optional(),
  repoScopes: z.array(z.string()).optional(),
  createdAt: z.string(),
}) satisfies z.ZodType<CollabOrgRecord>;

export const CollabMemberRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  displayName: z.string(),
  avatar: CollabAvatarIdentitySchema,
  role: CollabRoleSchema,
  identityKind: CollabIdentityKindSchema,
  joinedAt: z.string(),
  removedAt: z.string().optional(),
}) satisfies z.ZodType<CollabMemberRecord>;

export const RemoteTeammateSessionMetadataSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  ownerMemberId: z.string(),
  ownerUserId: z.string(),
  ownerDisplayName: z.string(),
  ownerIdentityKind: CollabIdentityKindSchema,
  sourceSessionId: z.string(),
  title: z.string(),
  status: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  lastActivityAt: z.string().optional(),
  accessMode: CollabSessionAccessModeSchema.optional(),
  eventsBlobPath: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  eventsContentHash: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  eventsUpdatedAt: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
}) satisfies z.ZodType<RemoteTeammateSessionMetadata>;

export const CollabChatMessageRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  authorMemberId: z.string(),
  authorDisplayName: z.string(),
  authorIdentityKind: CollabIdentityKindSchema,
  body: z.string(),
  createdAt: z.string(),
}) satisfies z.ZodType<CollabChatMessageRecord>;

const BaseEnvelopeSchema = z.object({
  protocolVersion: z.literal(COLLAB_PROTOCOL_VERSION),
  id: z.string(),
  orgId: z.string(),
  senderMemberId: z.string(),
  sentAt: z.string(),
});

const PresenceUpdateEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.PRESENCE_UPDATE),
  payload: z.object({
    member: CollabMemberRecordSchema,
    active: z.boolean(),
  }),
});

const SessionMetadataUpsertEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.SESSION_METADATA_UPSERT),
  payload: z.object({
    session: RemoteTeammateSessionMetadataSchema,
  }),
});

const SessionMetadataRemoveEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.SESSION_METADATA_REMOVE),
  payload: z.object({
    sessionId: z.string(),
  }),
});

const SessionSnapshotRequestEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.SESSION_SNAPSHOT_REQUEST),
  payload: z.object({
    requestId: z.string(),
    sourceSessionId: z.string(),
    ownerMemberId: z.string(),
  }),
});

const SessionSnapshotResponseEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.SESSION_SNAPSHOT_RESPONSE),
  payload: z.object({
    requestId: z.string(),
    sourceSessionId: z.string(),
    session: RemoteTeammateSessionMetadataSchema,
    events: z.array(z.custom<SessionEvent>()),
  }),
});

const SessionSnapshotDeniedEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.SESSION_SNAPSHOT_DENIED),
  payload: z.object({
    requestId: z.string(),
    sourceSessionId: z.string(),
    reason: z.string(),
  }),
});

const ChatMessageEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.CHAT_MESSAGE),
  payload: z.object({
    message: CollabChatMessageRecordSchema,
  }),
});

export const CollabMessageEnvelopeSchema = z.discriminatedUnion("type", [
  PresenceUpdateEnvelopeSchema,
  SessionMetadataUpsertEnvelopeSchema,
  SessionMetadataRemoveEnvelopeSchema,
  SessionSnapshotRequestEnvelopeSchema,
  SessionSnapshotResponseEnvelopeSchema,
  SessionSnapshotDeniedEnvelopeSchema,
  ChatMessageEnvelopeSchema,
]);

export type CollabMessageEnvelope = z.infer<typeof CollabMessageEnvelopeSchema>;

export function parseCollabMessageEnvelope(
  value: unknown
): CollabMessageEnvelope {
  return CollabMessageEnvelopeSchema.parse(value);
}

export function normalizeSupabaseProjectUrl(supabaseUrl: string): string {
  const parsed = new URL(supabaseUrl.trim());
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export function buildCollabInviteLink({
  supabaseUrl,
  anonKey,
  inviteCode,
}: {
  supabaseUrl: string;
  anonKey?: string;
  inviteCode: string;
}): string {
  const params = new URLSearchParams({
    sync: COLLAB_SYNC_BACKEND.SUPABASE,
    supabase: normalizeSupabaseProjectUrl(supabaseUrl),
    invite: inviteCode,
  });
  if (anonKey) params.set("anon", anonKey);
  return `orgii://collaboration/join?${params.toString()}`;
}

export function parseCollabInviteInput(input: string): {
  syncBackend?: CollabSyncBackend;
  supabaseUrl?: string;
  anonKey?: string;
  inviteCode: string;
} {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Invite code is required");

  if (trimmed.startsWith("orgii://")) {
    const parsed = new URL(trimmed);
    const inviteCode = parsed.searchParams.get("invite")?.trim();
    if (!inviteCode) throw new Error("Invite link is missing invite code");
    const syncParam = parsed.searchParams.get("sync")?.trim();
    return {
      syncBackend:
        syncParam === COLLAB_SYNC_BACKEND.SUPABASE
          ? COLLAB_SYNC_BACKEND.SUPABASE
          : undefined,
      supabaseUrl: parsed.searchParams.get("supabase")?.trim() || undefined,
      anonKey: parsed.searchParams.get("anon")?.trim() || undefined,
      inviteCode,
    };
  }

  return { inviteCode: trimmed };
}

export function createCollabAvatarIdentity(
  displayName: string
): CollabAvatarIdentity {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = (words[0]?.[0] ?? "U") + (words[1]?.[0] ?? "");
  const normalizedInitials = initials.toLocaleUpperCase();
  const variantSeed = [...displayName].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0
  );
  return {
    initials: normalizedInitials.slice(0, 2),
    variant: variantSeed % 2 === 0 ? "v" : "h",
  };
}
