import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import {
  CollabChatMessageRecordSchema,
  CollabMemberRecordSchema,
  CollabOrgRecordSchema,
  CollabRepoJoinRequestRecordSchema,
  CollabRoleSchema,
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
  inviteCode: z.string().optional(),
  inviteLink: z.string().optional(),
  usageLimit: z.number(),
  usageCount: z.number(),
  role: CollabRoleSchema.optional(),
  codeSuffix: z.string().optional(),
  createdByMemberId: z.string().optional(),
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

/**
 * @deprecated M6 (design §16.2): shared projects are NATIVE rows in the
 * local project store, synced by the engine's ProjectSyncChannel and read
 * through `projectApi` scoped by `org.projectOrgId ?? org.id`. Nothing
 * writes this mirror anymore; it is kept only so persisted localStorage
 * state keeps parsing until the atom is removed outright.
 */
export const collabProjectsAtom = atomWithStorage<
  CollabProjectMetadataRecord[]
>(
  collabStorageKey("collabProjects"),
  [],
  createZodJsonStorage(CollabProjectsSchema),
  { getOnInit: true }
);
collabProjectsAtom.debugLabel = "collabProjectsAtom";

/**
 * @deprecated M6 (design §16.2): see {@link collabProjectsAtom} — shared
 * work items are native local rows now; this mirror is write-dead.
 */
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

/**
 * Owner-side segments push cursor, per (orgId, sessionId) — design §7.3.
 * The per-event hash vector itself is NOT persisted: `frozenChainHash` is a
 * sha256 chain over the frozen region's per-event hashes, which detects
 * frozen-region mutation with O(1) storage. Losing a cursor (reinstall,
 * cleared storage) is safe — the next push re-anchors through the server
 * OCC check (rewrite at server epoch + 1).
 */
export interface CollabSessionPushCursor {
  orgId: string;
  sessionId: string;
  /** Segments epoch last acknowledged by the server. */
  epoch: number;
  /** Highest frozen segment seq pushed in this epoch. */
  frozenSeq: number;
  /** Total events (frozen + tail) covered by the last push. */
  pushedCount: number;
  /** Events covered by the frozen region (local frozen-line position). */
  frozenEventCount: number;
  /** sha256 over the concatenated per-event hashes of the frozen region. */
  frozenChainHash: string;
  /** segment_hash of the last pushed tail (null = tail was empty). */
  tailHash: string | null;
}

const CollabSessionPushCursorSchema = z.object({
  orgId: z.string(),
  sessionId: z.string(),
  epoch: z.number(),
  frozenSeq: z.number(),
  pushedCount: z.number(),
  frozenEventCount: z.number(),
  frozenChainHash: z.string(),
  tailHash: z.string().nullable(),
}) satisfies z.ZodType<CollabSessionPushCursor>;

const CollabSessionPushCursorsSchema = z.record(
  z.string(),
  CollabSessionPushCursorSchema
);

/** Keyed by `${orgId}:${sessionId}`. */
export const collabSessionPushCursorsAtom = atomWithStorage<
  Record<string, CollabSessionPushCursor>
>(
  collabStorageKey("collabSessionPushCursors"),
  {},
  createZodJsonStorage(CollabSessionPushCursorsSchema),
  { getOnInit: true }
);
collabSessionPushCursorsAtom.debugLabel = "collabSessionPushCursorsAtom";

/**
 * Owner-side record of every session key (`${orgId}:${sessionId}`) whose
 * metadata was successfully published to that org, mapped to the ISO
 * timestamp of the first publish. Persisted so the engine's deleted-session
 * tombstone sweep survives a restart: the in-memory metadata-hash map dies
 * with the process, and without this set a session deleted while the app was
 * closed (or before the next sweep of a fresh run) would keep its remote
 * metadata + segments visible to teammates forever. Written on successful
 * `upsertSessionMetadata`, pruned when the tombstone is sent.
 */
const CollabPublishedSessionKeysSchema = z.record(z.string(), z.string());

export const collabPublishedSessionKeysAtom = atomWithStorage<
  Record<string, string>
>(
  collabStorageKey("collabPublishedSessionKeys"),
  {},
  createZodJsonStorage(CollabPublishedSessionKeysSchema),
  { getOnInit: true }
);
collabPublishedSessionKeysAtom.debugLabel = "collabPublishedSessionKeysAtom";

/**
 * One-shot bridge from CollabSyncEngine (plain TS, cannot call React hooks)
 * to the UI: when the engine finishes importing a snapshot that should be
 * opened, it parks the target here; `useCollabSyncEngine` consumes it
 * (read → openSession → reset to null). Aligned with the pendingInvite
 * pattern; deliberately NOT persisted.
 */
export interface CollabPendingOpenSession {
  sessionId: string;
  title: string;
  repoPath?: string;
}

export const collabPendingOpenSessionAtom =
  atom<CollabPendingOpenSession | null>(null);
collabPendingOpenSessionAtom.debugLabel = "collabPendingOpenSessionAtom";
