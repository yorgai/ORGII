import { z } from "zod/v4";

import {
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
  type CollabAvatarIdentity,
  type CollabIdentityKind,
  type CollabMemberRecord,
  type CollabOrgRecord,
  type CollabRole,
  type RemoteTeammateSessionMetadata,
} from "./types";

export const COLLAB_PROTOCOL_VERSION = 1;

export const COLLAB_MESSAGE_TYPE = {
  PRESENCE_UPDATE: "presence.update",
  SESSION_METADATA_UPSERT: "session.metadata.upsert",
  SESSION_METADATA_REMOVE: "session.metadata.remove",
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

export const CollabAvatarIdentitySchema = z.object({
  initials: z.string(),
  variant: z.string(),
}) satisfies z.ZodType<CollabAvatarIdentity>;

export const CollabOrgRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  hubUrl: z.string().optional(),
  groupId: z.string().optional(),
  adminMemberId: z.string().optional(),
  createdAt: z.string(),
}) satisfies z.ZodType<CollabOrgRecord>;

export const CollabMemberRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  displayName: z.string(),
  avatar: CollabAvatarIdentitySchema,
  role: CollabRoleSchema,
  identityKind: CollabIdentityKindSchema,
  accessToken: z.string().optional(),
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
}) satisfies z.ZodType<RemoteTeammateSessionMetadata>;

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

const ChatMessageEnvelopeSchema = BaseEnvelopeSchema.extend({
  type: z.literal(COLLAB_MESSAGE_TYPE.CHAT_MESSAGE),
  payload: z.object({
    text: z.string(),
  }),
});

export const CollabMessageEnvelopeSchema = z.discriminatedUnion("type", [
  PresenceUpdateEnvelopeSchema,
  SessionMetadataUpsertEnvelopeSchema,
  SessionMetadataRemoveEnvelopeSchema,
  ChatMessageEnvelopeSchema,
]);

export type CollabMessageEnvelope = z.infer<typeof CollabMessageEnvelopeSchema>;

export function parseCollabMessageEnvelope(
  value: unknown
): CollabMessageEnvelope {
  return CollabMessageEnvelopeSchema.parse(value);
}

export function normalizeCollabHubUrl(hubUrl: string): string {
  const parsed = new URL(hubUrl.trim());
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export function toCollabWebSocketUrl(hubUrl: string, orgId: string): string {
  const normalized = normalizeCollabHubUrl(hubUrl);
  const url = new URL(`${normalized}/orgs/${encodeURIComponent(orgId)}/ws`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function buildCollabInviteLink({
  hubUrl,
  inviteCode,
}: {
  hubUrl: string;
  inviteCode: string;
}): string {
  const params = new URLSearchParams({
    hub: normalizeCollabHubUrl(hubUrl),
    invite: inviteCode,
  });
  return `orgii://collaboration/join?${params.toString()}`;
}

export function parseCollabInviteInput(input: string): {
  hubUrl?: string;
  inviteCode: string;
} {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Invite code is required");

  if (trimmed.startsWith("orgii://")) {
    const parsed = new URL(trimmed);
    const inviteCode = parsed.searchParams.get("invite")?.trim();
    if (!inviteCode) throw new Error("Invite link is missing invite code");
    return {
      hubUrl: parsed.searchParams.get("hub")?.trim() || undefined,
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
