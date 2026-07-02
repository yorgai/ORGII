import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_SESSION_ACCESS_MODE,
} from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabSessionAccessMode,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { formatSmartDateTime } from "@src/util/data/formatters/date";

const SESSION_STATUS_COLOR = {
  [COLLAB_CONNECTION_STATUS.CONNECTED]: "var(--color-success-6)",
  [COLLAB_CONNECTION_STATUS.CONNECTING]: "var(--color-warning-6)",
  [COLLAB_CONNECTION_STATUS.DISCONNECTED]: "var(--color-text-4)",
  [COLLAB_CONNECTION_STATUS.ERROR]: "var(--color-danger-6)",
} as const;

export function createLocalChatMessageId(orgId: string): string {
  return `${orgId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function formatSessionDate(
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  return formatSmartDateTime(value);
}

export function getInviteRemainingUses(invite: CollabInviteRecord): number {
  return Math.max(0, invite.usageLimit - invite.usageCount);
}

/** Active = not revoked, not exhausted, not past its expiry (design §8.1). */
export function isInviteActive(
  invite: CollabInviteRecord,
  nowMs: number = Date.now()
): boolean {
  if (invite.revokedAt) return false;
  if (getInviteRemainingUses(invite) <= 0) return false;
  if (invite.expiresAt) {
    const expiresMs = Date.parse(invite.expiresAt);
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return false;
  }
  return true;
}

/** Active invites of one org, newest first (members-tab invite list, §8.1). */
export function getActiveOrgInvites(
  invites: CollabInviteRecord[],
  orgId: string,
  nowMs: number = Date.now()
): CollabInviteRecord[] {
  return invites
    .filter((invite) => invite.orgId === orgId && isInviteActive(invite, nowMs))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * ORGII_LAST_ADMIN surfaces from `orgii_remove_member` /
 * `orgii_update_member_role` when the target is the only remaining admin;
 * the raw code must be translated into a human explanation (§8.4).
 */
export function isCollabLastAdminError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ORGII_LAST_ADMIN");
}

export function isToday(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function normalizeWorkspacePath(
  path: string | undefined
): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

export function toSessionTableItem(
  session: RemoteTeammateSessionMetadata,
  fallbackStatusLabel: string,
  metadataOnlyLabel: string
): SessionTableItem {
  return {
    id: session.id,
    title: session.title,
    description: session.ownerDisplayName,
    statusLabel:
      session.accessMode === COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY
        ? metadataOnlyLabel
        : (session.status ?? fallbackStatusLabel),
    statusColor: SESSION_STATUS_COLOR[COLLAB_CONNECTION_STATUS.CONNECTED],
    agentLabel: session.ownerDisplayName,
    workspaceLabel: session.repoPath,
    workspaceTitle: session.repoPath,
    modelLabel: session.branch,
    startedLabel: formatSessionDate(session.lastActivityAt),
    lastUpdatedLabel: formatSessionDate(session.lastActivityAt),
  };
}

export function upsertChatMessage(
  messages: CollabChatMessageRecord[],
  incoming: CollabChatMessageRecord
): CollabChatMessageRecord[] {
  const existingIndex = messages.findIndex(
    (message) => message.id === incoming.id
  );
  if (existingIndex < 0) return [...messages, incoming];
  const next = [...messages];
  next[existingIndex] = incoming;
  return next;
}

export function upsertInvite(
  invites: CollabInviteRecord[],
  incoming: CollabInviteRecord
): CollabInviteRecord[] {
  const existingIndex = invites.findIndex(
    (invite) => invite.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...invites];
  const next = [...invites];
  next[existingIndex] = incoming;
  return next;
}

export function replaceOrgMetadata<TRecord extends Record<string, unknown>>(
  records: TRecord[],
  orgId: string,
  incoming: TRecord[]
): TRecord[] {
  return [...incoming, ...records.filter((record) => record.orgId !== orgId)];
}

export function upsertMember(
  members: CollabMemberRecord[],
  incoming: CollabMemberRecord
): CollabMemberRecord[] {
  const existingIndex = members.findIndex(
    (member) => member.id === incoming.id
  );
  if (existingIndex < 0) return [incoming, ...members];
  const next = [...members];
  next[existingIndex] = { ...members[existingIndex], ...incoming };
  return next;
}

// Single source of the default-OFF access settings (design §6.3, fix S8):
// the panel and the sync engine must agree, so the implementation lives in
// collabSyncUtils and is re-exported here for the panel hooks.
export { createDefaultAccessSettings } from "@src/features/TeamCollaboration/collabSyncUtils";

/**
 * One-time shareSince prompt gate (design §6.2/§6.3): only the OFF → shared
 * transition asks "all history vs only new sessions"; moving between
 * metadata_only and full_replay keeps the previous choice silently.
 */
export function shouldPromptShareOnboarding(
  currentMode: CollabSessionAccessMode | undefined,
  nextMode: CollabSessionAccessMode
): boolean {
  return (
    currentMode === COLLAB_SESSION_ACCESS_MODE.OFF &&
    nextMode !== COLLAB_SESSION_ACCESS_MODE.OFF
  );
}

export interface SessionsTabBanners {
  /** Member's own default accessMode is OFF → nothing of theirs is shared. */
  showAccessOffBanner: boolean;
  /** Org repoScopes is empty → nobody's sessions sync (separate silent gate). */
  showRepoScopesEmptyBanner: boolean;
}

/**
 * Sessions-tab onboarding banners (design §6.3): the two silent gates are
 * reported separately — "your default is OFF" and "the org has no repos in
 * scope" have different fixes (member settings vs admin action).
 */
export function getSessionsTabBanners({
  accessMode,
  repoScopes,
}: {
  accessMode: CollabSessionAccessMode | undefined;
  repoScopes: string[] | undefined;
}): SessionsTabBanners {
  return {
    showAccessOffBanner: accessMode === COLLAB_SESSION_ACCESS_MODE.OFF,
    showRepoScopesEmptyBanner: !repoScopes || repoScopes.length === 0,
  };
}
