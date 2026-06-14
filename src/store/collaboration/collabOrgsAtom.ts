import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import type { CollabOrgRecord, RemoteTeammateSessionMetadata } from "./types";

const CollabOrgRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  hubUrl: z.string().optional(),
  groupId: z.string().optional(),
  createdAt: z.string(),
});

const RemoteTeammateSessionMetadataSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  ownerUserId: z.string(),
  ownerDisplayName: z.string(),
  sourceSessionId: z.string(),
  title: z.string(),
  status: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  lastActivityAt: z.string().optional(),
});

const CollabOrgsSchema = z.array(CollabOrgRecordSchema);
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

export const remoteTeammateSessionsAtom = atomWithStorage<
  RemoteTeammateSessionMetadata[]
>(
  "orgii:remoteTeammateSessions",
  [],
  createZodJsonStorage(RemoteTeammateSessionsSchema),
  { getOnInit: true }
);
remoteTeammateSessionsAtom.debugLabel = "remoteTeammateSessionsAtom";
