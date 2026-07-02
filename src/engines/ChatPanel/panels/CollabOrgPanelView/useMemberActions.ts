import { useAtom, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { projectApi } from "@src/api/http/project";
import { getSyncProfile } from "@src/features/TeamCollaboration/collabSyncUtils";
import { computeLeaveOrgCleanup } from "@src/features/TeamCollaboration/leaveOrgCleanup";
import { supabaseSyncClient } from "@src/features/TeamCollaboration/sync/supabaseSyncClient";
import {
  collabChatMessagesAtom,
  collabConnectionStatesAtom,
  collabInvitesAtom,
  collabLastSyncTimestampsAtom,
  collabMembersAtom,
  collabOrgsAtom,
  collabRepoJoinRequestsAtom,
  collabSessionAccessSettingsAtom,
  collabSessionPushCursorsAtom,
  collabSessionSnapshotRequestsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  PANEL_INVITE_USAGE_LIMIT,
  getInviteExpiresAt,
} from "@src/store/collaboration/inviteDefaults";
import { COLLAB_ROLE } from "@src/store/collaboration/types";
import type {
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
  CollabRole,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session/sessionAtom/atoms";
import { persistSessions } from "@src/store/session/sessionAtom/persistence";
import type { ChatPanelSelectedCollabOrg } from "@src/store/ui/chatPanelAtom";
import { chatPanelSelectedCollabOrgAtom } from "@src/store/ui/chatPanelAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { copyText } from "@src/util/data/clipboard";

import {
  getActiveOrgInvites,
  isCollabLastAdminError,
  upsertInvite,
  upsertMember,
} from "./utils";

export interface CreateInviteOptions {
  usageLimit: number;
  /** null = the invite never expires. */
  expiresInDays: number | null;
  role: CollabRole;
}

interface UseMemberActionsParams {
  org: CollabOrgRecord | undefined;
  currentMember: CollabMemberRecord | undefined;
  selectedCollabOrg: ChatPanelSelectedCollabOrg;
}

export function useMemberActions({
  org,
  currentMember,
  selectedCollabOrg,
}: UseMemberActionsParams) {
  const { t } = useTranslation("navigation");
  const [invites, setInvites] = useAtom(collabInvitesAtom);
  const setMembers = useSetAtom(collabMembersAtom);
  const setSelectedCollabOrg = useSetAtom(chatPanelSelectedCollabOrgAtom);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copyingInvite, setCopyingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [updatingRoleMemberId, setUpdatingRoleMemberId] = useState<
    string | null
  >(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [leavingOrg, setLeavingOrg] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // The pull loop fills collabInvitesAtom for admins only (invites are an
  // admin-only segment of listOrgState since M1); non-admin members simply
  // see an empty list here.
  const activeInvites = useMemo(
    () => getActiveOrgInvites(invites, selectedCollabOrg.orgId),
    [invites, selectedCollabOrg.orgId]
  );

  // Plaintext links exist only on the creating client (design §8.1); the
  // quick-copy card shows the newest invite this device can still copy.
  const latestInvite = useMemo(
    () => activeInvites.find((invite) => invite.inviteLink),
    [activeInvites]
  );

  const syncProfile = useMemo(() => (org ? getSyncProfile(org) : null), [org]);

  const canCreateInvite =
    syncProfile !== null && currentMember?.role === COLLAB_ROLE.ADMIN;

  const handleCreateInvite = useCallback(
    async (options?: CreateInviteOptions) => {
      if (!org || !syncProfile || creatingInvite) return;
      // Panel default: single-use / 7 days / member (design §8.1); the
      // bootstrap 10-use invite is minted by CreateCollabOrgView only.
      const usageLimit = options?.usageLimit ?? PANEL_INVITE_USAGE_LIMIT;
      const expiresInDays =
        options === undefined
          ? DEFAULT_INVITE_EXPIRY_DAYS
          : options.expiresInDays;
      const role = options?.role ?? COLLAB_ROLE.MEMBER;
      setCreatingInvite(true);
      setInviteError(null);
      try {
        const invite = await supabaseSyncClient.createInvite({
          ...syncProfile,
          orgId: org.id,
          usageLimit,
          expiresAt:
            expiresInDays === null
              ? undefined
              : getInviteExpiresAt(expiresInDays),
          role,
        });
        setInvites((current) => upsertInvite(current, invite));
        if (invite.inviteLink) {
          await copyText(invite.inviteLink);
          setCopyingInvite(true);
          window.setTimeout(() => setCopyingInvite(false), 1500);
        }
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : String(error));
      } finally {
        setCreatingInvite(false);
      }
    },
    [creatingInvite, org, setInvites, syncProfile]
  );

  const handleCopyInvite = useCallback(
    async (invite?: CollabInviteRecord) => {
      const inviteLink = (invite ?? latestInvite)?.inviteLink;
      if (!inviteLink || copyingInvite) return;
      setInviteError(null);
      try {
        await copyText(inviteLink);
        setCopyingInvite(true);
        window.setTimeout(() => setCopyingInvite(false), 1500);
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : String(error));
      }
    },
    [copyingInvite, latestInvite]
  );

  const handleRevokeInvite = useCallback(
    async (invite: CollabInviteRecord) => {
      if (!org || !syncProfile || revokingInviteId) return;
      setRevokingInviteId(invite.id);
      setInviteError(null);
      try {
        await supabaseSyncClient.revokeInvite({
          ...syncProfile,
          orgId: org.id,
          inviteId: invite.id,
        });
        const revokedAt = new Date().toISOString();
        setInvites((current) =>
          current.map((item) =>
            item.id === invite.id ? { ...item, revokedAt } : item
          )
        );
      } catch (error) {
        setInviteError(error instanceof Error ? error.message : String(error));
      } finally {
        setRevokingInviteId(null);
      }
    },
    [org, revokingInviteId, setInvites, syncProfile]
  );

  const handleUpdateMemberRole = useCallback(
    async (member: CollabMemberRecord, role: CollabRole) => {
      if (!org || !syncProfile || updatingRoleMemberId) return;
      setUpdatingRoleMemberId(member.id);
      setMemberError(null);
      try {
        await supabaseSyncClient.updateMemberRole({
          ...syncProfile,
          orgId: org.id,
          targetMemberId: member.id,
          role,
        });
        setMembers((current) => upsertMember(current, { ...member, role }));
      } catch (error) {
        setMemberError(
          isCollabLastAdminError(error)
            ? t("collaboration.members.lastAdminError")
            : error instanceof Error
              ? error.message
              : String(error)
        );
      } finally {
        setUpdatingRoleMemberId(null);
      }
    },
    [org, setMembers, syncProfile, t, updatingRoleMemberId]
  );

  const handleRemoveMember = useCallback(
    async (member: CollabMemberRecord) => {
      if (!org || !syncProfile || removingMemberId) return;
      setRemovingMemberId(member.id);
      setMemberError(null);
      try {
        const removedMember = await supabaseSyncClient.removeMember({
          ...syncProfile,
          orgId: org.id,
          targetMemberId: member.id,
        });
        setMembers((current) => upsertMember(current, removedMember));
        if (selectedCollabOrg.memberId === member.id) {
          setSelectedCollabOrg({ orgId: selectedCollabOrg.orgId });
        }
      } catch (error) {
        setMemberError(
          isCollabLastAdminError(error)
            ? t("collaboration.members.lastAdminError")
            : error instanceof Error
              ? error.message
              : String(error)
        );
      } finally {
        setRemovingMemberId(null);
      }
    },
    [
      org,
      removingMemberId,
      selectedCollabOrg.memberId,
      selectedCollabOrg.orgId,
      setMembers,
      setSelectedCollabOrg,
      syncProfile,
      t,
    ]
  );

  /**
   * Leave org (design §8.4): self-removal on the server, then local cleanup
   * via the pure `computeLeaveOrgCleanup`. Removing the org record from
   * collabOrgsAtom is what makes CollabSyncEngine.reconcile() drop the pull
   * loop / push subscriptions for it automatically.
   */
  const handleLeaveOrg = useCallback(
    async (removeImportedCopies: boolean) => {
      if (!org || !syncProfile || !currentMember || leavingOrg) return;
      setLeavingOrg(true);
      setLeaveError(null);
      try {
        await supabaseSyncClient.removeMember({
          ...syncProfile,
          orgId: org.id,
          targetMemberId: currentMember.id,
        });
        const store = getInstrumentedStore();
        const cleanup = computeLeaveOrgCleanup(
          {
            orgs: store.get(collabOrgsAtom),
            members: store.get(collabMembersAtom),
            invites: store.get(collabInvitesAtom),
            accessSettings: store.get(collabSessionAccessSettingsAtom),
            repoJoinRequests: store.get(collabRepoJoinRequestsAtom),
            chatMessages: store.get(collabChatMessagesAtom),
            snapshotRequests: store.get(collabSessionSnapshotRequestsAtom),
            remoteSessions: store.get(remoteTeammateSessionsAtom),
            connectionStates: store.get(collabConnectionStatesAtom),
            pushCursors: store.get(collabSessionPushCursorsAtom),
            lastSyncTimestamps: store.get(collabLastSyncTimestampsAtom),
            sessions: store.get(sessionsAtom),
          },
          org.id,
          { removeImportedSessions: removeImportedCopies }
        );
        store.set(collabOrgsAtom, cleanup.orgs);
        store.set(collabMembersAtom, cleanup.members);
        store.set(collabInvitesAtom, cleanup.invites);
        store.set(collabSessionAccessSettingsAtom, cleanup.accessSettings);
        store.set(collabRepoJoinRequestsAtom, cleanup.repoJoinRequests);
        store.set(collabChatMessagesAtom, cleanup.chatMessages);
        store.set(collabSessionSnapshotRequestsAtom, cleanup.snapshotRequests);
        store.set(remoteTeammateSessionsAtom, cleanup.remoteSessions);
        store.set(collabConnectionStatesAtom, cleanup.connectionStates);
        store.set(collabSessionPushCursorsAtom, cleanup.pushCursors);
        store.set(collabLastSyncTimestampsAtom, cleanup.lastSyncTimestamps);
        if (cleanup.removedSessionIds.length > 0) {
          store.set(sessionsAtom, cleanup.sessions);
          persistSessions(cleanup.sessions);
        }
        // When the member opts to scrub imported copies, also purge the
        // teammate project/work-item native rows synced under this org's
        // aliased project org (deleting a project cascades its work items).
        // Best-effort: a failure here must not undo the leave.
        //
        // KNOWN GAP (Rust-side follow-up): the aliased project org is still
        // marked collab-synced (source='collab' / sync_provider='orgii_collab')
        // when these deletes run, so each one enqueues an orgii_collab DELETE
        // tombstone into the outbox of an org we just left. The member
        // credential is gone, the engine drops the org from its reconcile
        // loop, and those rows can never be drained or acked — they sit in
        // the outbox forever, and the project_org keeps its collab marking.
        // The project api has no unmark today
        // (`project_configure_org_collab_sync` only MARKS an org); clearing
        // the marking before the purge plus purging the org's outbox rows
        // needs a Rust-side command (org unmark + outbox purge on leave).
        if (removeImportedCopies) {
          const projectOrgId = org.projectOrgId ?? org.id;
          try {
            const projects = await projectApi.readProjects({
              orgId: projectOrgId,
            });
            for (const project of projects) {
              await projectApi.deleteProject(project.slug);
            }
          } catch {
            // Leave already succeeded; leftover project rows are cosmetic.
          }
        }
        // The org no longer exists locally — drop the panel selection.
        setSelectedCollabOrg(null);
      } catch (error) {
        setLeaveError(
          isCollabLastAdminError(error)
            ? t("collaboration.leave.lastAdminError")
            : error instanceof Error
              ? error.message
              : String(error)
        );
      } finally {
        setLeavingOrg(false);
      }
    },
    [currentMember, leavingOrg, org, setSelectedCollabOrg, syncProfile, t]
  );

  return {
    activeInvites,
    latestInvite,
    canCreateInvite,
    creatingInvite,
    copyingInvite,
    inviteError,
    revokingInviteId,
    removingMemberId,
    updatingRoleMemberId,
    memberError,
    leavingOrg,
    leaveError,
    handleCreateInvite,
    handleCopyInvite,
    handleRevokeInvite,
    handleUpdateMemberRole,
    handleRemoveMember,
    handleLeaveOrg,
  };
}
