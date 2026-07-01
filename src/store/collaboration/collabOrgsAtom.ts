import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import {
  CollabChatMessageRecordSchema,
  CollabMemberRecordSchema,
  CollabOrgRecordSchema,
  CollabRepoJoinRequestRecordSchema,
  CollabSessionAccessSettingsSchema,
  RemoteTeammateSessionMetadataSchema,
} from "./protocol";
import { COLLAB_CONNECTION_STATUS } from "./types";
import type {
  CollabChatMessageRecord,
  CollabConnectionStatus,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  CollabProjectMetadataRecord,
  CollabRepoJoinRequestRecord,
  CollabSessionAccessSettings,
  CollabSessionSnapshotRequestRecord,
  CollabWorkItemMetadataRecord,
  RemoteTeammateSessionMetadata,
} from "./types";

const SUPABASE_SYNC_STORAGE_VERSION = "supabase-v1";

function collabStorageKey(name: string): string {
  return `orgii:${SUPABASE_SYNC_STORAGE_VERSION}:${name}`;
}

const LEGACY_CLOUDFLARE_COLLAB_STORAGE_KEYS = [
  "orgii:collabOrgs",
  "orgii:collabMembers",
  "orgii:collabInvites",
  "orgii:collabProjects",
  "orgii:collabWorkItems",
  "orgii:collabConnectionStates",
  "orgii:collabChatMessages",
  "orgii:collabSessionAccessSettings",
  "orgii:collabSessionSnapshotRequests",
  "orgii:remoteTeammateSessions",
] as const;

if (typeof window !== "undefined") {
  for (const key of LEGACY_CLOUDFLARE_COLLAB_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
}

const CollabInviteRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  supabaseUrl: z.string().optional(),
  supabaseAnonKey: z.string().optional(),
  inviteCode: z.string(),
  inviteLink: z.string(),
  usageLimit: z.number(),
  usageCount: z.number(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
}) satisfies z.ZodType<CollabInviteRecord>;

const CollabMetadataRecordSchema = z.record(z.string(), z.unknown());

const CollabConnectionStatusSchema = z.enum([
  COLLAB_CONNECTION_STATUS.DISCONNECTED,
  COLLAB_CONNECTION_STATUS.CONNECTING,
  COLLAB_CONNECTION_STATUS.CONNECTED,
  COLLAB_CONNECTION_STATUS.ERROR,
] satisfies [
  CollabConnectionStatus,
  CollabConnectionStatus,
  CollabConnectionStatus,
  CollabConnectionStatus,
]);

const CollabOrgConnectionStateSchema = z.object({
  orgId: z.string(),
  status: CollabConnectionStatusSchema,
  error: z.string().optional(),
  updatedAt: z.string(),
}) satisfies z.ZodType<CollabOrgConnectionState>;

const CollabSessionSnapshotRequestRecordSchema = z.object({
  requestId: z.string(),
  orgId: z.string(),
  requesterMemberId: z.string(),
  ownerMemberId: z.string(),
  sourceSessionId: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending", "sent", "denied", "completed", "failed"]),
  error: z.string().optional(),
}) satisfies z.ZodType<CollabSessionSnapshotRequestRecord>;

const CollabOrgsSchema = z.array(CollabOrgRecordSchema);
const CollabMembersSchema = z.array(CollabMemberRecordSchema);
const CollabInvitesSchema = z.array(CollabInviteRecordSchema);
const CollabProjectsSchema = z.array(
  CollabMetadataRecordSchema
) satisfies z.ZodType<CollabProjectMetadataRecord[]>;
const CollabWorkItemsSchema = z.array(
  CollabMetadataRecordSchema
) satisfies z.ZodType<CollabWorkItemMetadataRecord[]>;
const CollabConnectionStatesSchema = z.array(CollabOrgConnectionStateSchema);
const CollabChatMessagesSchema = z.array(CollabChatMessageRecordSchema);
const CollabSessionAccessSettingsListSchema = z.array(
  CollabSessionAccessSettingsSchema
);
const CollabSessionSnapshotRequestsSchema = z.array(
  CollabSessionSnapshotRequestRecordSchema
);
const CollabRepoJoinRequestsSchema = z.array(CollabRepoJoinRequestRecordSchema);
const RemoteTeammateSessionsSchema = z.array(
  RemoteTeammateSessionMetadataSchema
);
const CollabLastSyncTimestampsSchema = z.record(z.string(), z.string());

export const collabOrgsAtom = atomWithStorage<CollabOrgRecord[]>(
  collabStorageKey("collabOrgs"),
  [],
  createZodJsonStorage(CollabOrgsSchema),
  { getOnInit: true }
);
collabOrgsAtom.debugLabel = "collabOrgsAtom";

export const collabMembersAtom = atomWithStorage<CollabMemberRecord[]>(
  collabStorageKey("collabMembers"),
  [],
  createZodJsonStorage(CollabMembersSchema),
  { getOnInit: true }
);
collabMembersAtom.debugLabel = "collabMembersAtom";

export const collabInvitesAtom = atomWithStorage<CollabInviteRecord[]>(
  collabStorageKey("collabInvites"),
  [],
  createZodJsonStorage(CollabInvitesSchema),
  { getOnInit: true }
);
collabInvitesAtom.debugLabel = "collabInvitesAtom";

export const collabProjectsAtom = atomWithStorage<
  CollabProjectMetadataRecord[]
>(
  collabStorageKey("collabProjects"),
  [],
  createZodJsonStorage(CollabProjectsSchema),
  { getOnInit: true }
);
collabProjectsAtom.debugLabel = "collabProjectsAtom";

export const collabWorkItemsAtom = atomWithStorage<
  CollabWorkItemMetadataRecord[]
>(
  collabStorageKey("collabWorkItems"),
  [],
  createZodJsonStorage(CollabWorkItemsSchema),
  { getOnInit: true }
);
collabWorkItemsAtom.debugLabel = "collabWorkItemsAtom";

export const collabConnectionStatesAtom = atomWithStorage<
  CollabOrgConnectionState[]
>(
  collabStorageKey("collabConnectionStates"),
  [],
  createZodJsonStorage(CollabConnectionStatesSchema),
  { getOnInit: true }
);
collabConnectionStatesAtom.debugLabel = "collabConnectionStatesAtom";

export const collabChatMessagesAtom = atomWithStorage<
  CollabChatMessageRecord[]
>(
  collabStorageKey("collabChatMessages"),
  [],
  createZodJsonStorage(CollabChatMessagesSchema),
  { getOnInit: true }
);
collabChatMessagesAtom.debugLabel = "collabChatMessagesAtom";

export const collabSessionAccessSettingsAtom = atomWithStorage<
  CollabSessionAccessSettings[]
>(
  collabStorageKey("collabSessionAccessSettings"),
  [],
  createZodJsonStorage(CollabSessionAccessSettingsListSchema),
  { getOnInit: true }
);
collabSessionAccessSettingsAtom.debugLabel = "collabSessionAccessSettingsAtom";

export const collabSessionSnapshotRequestsAtom = atomWithStorage<
  CollabSessionSnapshotRequestRecord[]
>(
  collabStorageKey("collabSessionSnapshotRequests"),
  [],
  createZodJsonStorage(CollabSessionSnapshotRequestsSchema),
  { getOnInit: true }
);
collabSessionSnapshotRequestsAtom.debugLabel =
  "collabSessionSnapshotRequestsAtom";

export const remoteTeammateSessionsAtom = atomWithStorage<
  RemoteTeammateSessionMetadata[]
>(
  collabStorageKey("remoteTeammateSessions"),
  [],
  createZodJsonStorage(RemoteTeammateSessionsSchema),
  { getOnInit: true }
);
remoteTeammateSessionsAtom.debugLabel = "remoteTeammateSessionsAtom";

export const collabRepoJoinRequestsAtom = atomWithStorage<
  CollabRepoJoinRequestRecord[]
>(
  collabStorageKey("collabRepoJoinRequests"),
  [],
  createZodJsonStorage(CollabRepoJoinRequestsSchema),
  { getOnInit: true }
);
collabRepoJoinRequestsAtom.debugLabel = "collabRepoJoinRequestsAtom";

export const collabLastSyncTimestampsAtom = atomWithStorage<
  Record<string, string>
>(
  collabStorageKey("collabLastSyncTimestamps"),
  {},
  createZodJsonStorage(CollabLastSyncTimestampsSchema),
  { getOnInit: true }
);
collabLastSyncTimestampsAtom.debugLabel = "collabLastSyncTimestampsAtom";
