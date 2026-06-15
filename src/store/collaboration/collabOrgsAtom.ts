import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import {
  CollabMemberRecordSchema,
  CollabOrgRecordSchema,
  RemoteTeammateSessionMetadataSchema,
} from "./protocol";
import { COLLAB_CONNECTION_STATUS } from "./types";
import type {
  CollabConnectionStatus,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgConnectionState,
  CollabOrgRecord,
  RemoteTeammateSessionMetadata,
} from "./types";

const CollabInviteRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  hubUrl: z.string(),
  inviteCode: z.string(),
  inviteLink: z.string(),
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  revokedAt: z.string().optional(),
}) satisfies z.ZodType<CollabInviteRecord>;

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

const CollabOrgsSchema = z.array(CollabOrgRecordSchema);
const CollabMembersSchema = z.array(CollabMemberRecordSchema);
const CollabInvitesSchema = z.array(CollabInviteRecordSchema);
const CollabConnectionStatesSchema = z.array(CollabOrgConnectionStateSchema);
const RemoteTeammateSessionsSchema = z.array(
  RemoteTeammateSessionMetadataSchema
);

export const collabOrgsAtom = atomWithStorage<CollabOrgRecord[]>(
  "orgii:collabOrgs",
  [],
  createZodJsonStorage(CollabOrgsSchema),
  { getOnInit: true }
);
collabOrgsAtom.debugLabel = "collabOrgsAtom";

export const collabMembersAtom = atomWithStorage<CollabMemberRecord[]>(
  "orgii:collabMembers",
  [],
  createZodJsonStorage(CollabMembersSchema),
  { getOnInit: true }
);
collabMembersAtom.debugLabel = "collabMembersAtom";

export const collabInvitesAtom = atomWithStorage<CollabInviteRecord[]>(
  "orgii:collabInvites",
  [],
  createZodJsonStorage(CollabInvitesSchema),
  { getOnInit: true }
);
collabInvitesAtom.debugLabel = "collabInvitesAtom";

export const collabConnectionStatesAtom = atomWithStorage<
  CollabOrgConnectionState[]
>(
  "orgii:collabConnectionStates",
  [],
  createZodJsonStorage(CollabConnectionStatesSchema),
  { getOnInit: true }
);
collabConnectionStatesAtom.debugLabel = "collabConnectionStatesAtom";

export const remoteTeammateSessionsAtom = atomWithStorage<
  RemoteTeammateSessionMetadata[]
>(
  "orgii:remoteTeammateSessions",
  [],
  createZodJsonStorage(RemoteTeammateSessionsSchema),
  { getOnInit: true }
);
remoteTeammateSessionsAtom.debugLabel = "remoteTeammateSessionsAtom";
