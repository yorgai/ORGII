export interface CollabOrgRecord {
  id: string;
  name: string;
  hubUrl?: string;
  groupId?: string;
  createdAt: string;
}

export interface RemoteTeammateSessionMetadata {
  id: string;
  orgId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  sourceSessionId: string;
  title: string;
  status?: string;
  repoPath?: string;
  branch?: string;
  lastActivityAt?: string;
}
