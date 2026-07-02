import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  collabMembersAtom,
  collabOrgsAtom,
  collabSessionSnapshotRequestsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { COLLAB_ROLE } from "@src/store/collaboration/types";
import type { CollabMemberRecord } from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";
import type { ChatPanelSelectedCollabOrg } from "@src/store/ui/chatPanelAtom";
import { chatPanelSelectedCollabOrgAtom } from "@src/store/ui/chatPanelAtom";

import { COLLAB_ORG_TAB } from "./constants";
import type { CollabOrgTab } from "./constants";
import { useAccessSettingsModel } from "./useAccessSettingsModel";
import { useCollabOrgChat } from "./useCollabOrgChat";
import { useMemberActions } from "./useMemberActions";
import { useOrgLocalEntities } from "./useOrgLocalEntities";
import { useSessionActions } from "./useSessionActions";
import { useWorkItemActions } from "./useWorkItemActions";
import {
  getForkableSessionIds,
  getSessionsTabBanners,
  isToday,
  toSessionTableItem,
} from "./utils";

export function useCollabOrgPanelModel(
  selectedCollabOrg: ChatPanelSelectedCollabOrg
) {
  const { t } = useTranslation("navigation");
  const orgs = useAtomValue(collabOrgsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const remoteSessions = useAtomValue(remoteTeammateSessionsAtom);
  const members = useAtomValue(collabMembersAtom);
  const snapshotRequests = useAtomValue(collabSessionSnapshotRequestsAtom);
  const setSelectedCollabOrg = useSetAtom(chatPanelSelectedCollabOrgAtom);
  const [activeTab, setActiveTab] = useState<CollabOrgTab>(
    selectedCollabOrg.memberId
      ? COLLAB_ORG_TAB.MEMBERS
      : COLLAB_ORG_TAB.WORK_ITEMS
  );

  const org = useMemo(
    () => orgs.find((candidate) => candidate.id === selectedCollabOrg.orgId),
    [orgs, selectedCollabOrg.orgId]
  );

  const orgMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.orgId === selectedCollabOrg.orgId && !member.removedAt
      ),
    [members, selectedCollabOrg.orgId]
  );

  const selectedMember = useMemo(
    () =>
      selectedCollabOrg.memberId
        ? (orgMembers.find(
            (member) => member.id === selectedCollabOrg.memberId
          ) ?? null)
        : null,
    [orgMembers, selectedCollabOrg.memberId]
  );

  const currentMember = useMemo(
    () =>
      orgMembers.find((member) => member.id === org?.localMemberId) ??
      orgMembers.find((member) => member.role === COLLAB_ROLE.ADMIN) ??
      orgMembers[0],
    [org?.localMemberId, orgMembers]
  );

  const accessSettingsModel = useAccessSettingsModel({
    orgId: selectedCollabOrg.orgId,
    currentMember,
    sessions,
  });
  const chatModel = useCollabOrgChat({ org, orgMembers, currentMember, t });
  const memberActions = useMemberActions({
    org,
    currentMember,
    selectedCollabOrg,
  });
  // Native local rows (design §16.2), keyed by the aliased project org —
  // projectOrgId, NOT org.id (they differ when the alias matched an
  // existing local org by name).
  const { orgProjects, orgWorkItems, localMetadataError } =
    useOrgLocalEntities(org);

  // Work-item actions (design §16.7 / §16.9 / §16.11): open in
  // ProjectManager + replay teammate linked sessions through the shared
  // importer + fork-and-continue them as writable sessions.
  const {
    handleOpenWorkItem,
    handleReplayLinkedSession,
    handleForkLinkedSession,
    replayingSessionId,
    forkingLinkedSessionId,
  } = useWorkItemActions({ org, orgProjects, t });

  const orgSessions = useMemo(
    () =>
      remoteSessions.filter(
        (session) => session.orgId === selectedCollabOrg.orgId
      ),
    [remoteSessions, selectedCollabOrg.orgId]
  );

  const visibleSessions = useMemo(
    () =>
      selectedMember
        ? orgSessions.filter(
            (session) => session.ownerMemberId === selectedMember.id
          )
        : orgSessions,
    [orgSessions, selectedMember]
  );

  const sessionItems = useMemo(
    () =>
      visibleSessions.map((session) =>
        toSessionTableItem(
          session,
          t("collaboration.sessionStatusActive"),
          t("collaboration.access.metadataOnlyBadge")
        )
      ),
    [visibleSessions, t]
  );

  const {
    handleSelectSession,
    handleForkSession,
    importingSessionId,
    forkingSessionId,
  } = useSessionActions({
    org,
    orgSessions,
    sessions,
    currentMember,
    t,
  });

  // Fork gating (design §16.11): only replay-capable rows (published
  // segments) carry the ⑂ action — metadata-only cards have nothing to
  // inherit.
  const forkableSessionIds = useMemo(
    () => getForkableSessionIds(visibleSessions),
    [visibleSessions]
  );

  const activeMemberIds = useMemo(
    () =>
      new Set(
        orgSessions
          .filter((session) => isToday(session.lastActivityAt))
          .map((session) => session.ownerMemberId)
      ),
    [orgSessions]
  );

  const orgChatMessages = useMemo(
    () =>
      chatModel.chatMessages
        .filter((message) => message.orgId === selectedCollabOrg.orgId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [chatModel.chatMessages, selectedCollabOrg.orgId]
  );

  const latestSnapshotRequest = useMemo(
    () =>
      snapshotRequests
        .filter((request) => request.orgId === selectedCollabOrg.orgId)
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        )[0],
    [selectedCollabOrg.orgId, snapshotRequests]
  );

  const handleSelectMember = useCallback(
    (member: CollabMemberRecord) => {
      setSelectedCollabOrg({ orgId: member.orgId, memberId: member.id });
      setActiveTab(COLLAB_ORG_TAB.MEMBERS);
    },
    [setSelectedCollabOrg]
  );

  const handleBackToOrg = useCallback(() => {
    setSelectedCollabOrg({ orgId: selectedCollabOrg.orgId });
    setActiveTab(COLLAB_ORG_TAB.SESSIONS);
  }, [selectedCollabOrg.orgId, setSelectedCollabOrg]);

  const handleOpenSettingsTab = useCallback(() => {
    setActiveTab(COLLAB_ORG_TAB.SETTINGS);
  }, []);

  const sessionsTabBanners = useMemo(
    () =>
      getSessionsTabBanners({
        accessMode: accessSettingsModel.currentAccessSettings?.accessMode,
        repoScopes: org?.repoScopes,
      }),
    [accessSettingsModel.currentAccessSettings?.accessMode, org?.repoScopes]
  );

  const tabs = useMemo(() => {
    const baseTabs = [
      {
        key: COLLAB_ORG_TAB.WORK_ITEMS,
        label: t("collaboration.tabs.workItems"),
      },
      { key: COLLAB_ORG_TAB.PROJECTS, label: t("collaboration.tabs.projects") },
      { key: COLLAB_ORG_TAB.SESSIONS, label: t("collaboration.tabs.sessions") },
      { key: COLLAB_ORG_TAB.MEMBERS, label: t("collaboration.tabs.members") },
      { key: COLLAB_ORG_TAB.CHAT, label: t("collaboration.tabs.chat") },
    ];
    if (!currentMember) return baseTabs;
    return [
      ...baseTabs,
      { key: COLLAB_ORG_TAB.SETTINGS, label: t("collaboration.tabs.settings") },
    ];
  }, [currentMember, t]);

  return {
    t,
    org,
    activeTab,
    setActiveTab,
    draftMessage: chatModel.draftMessage,
    setDraftMessage: chatModel.setDraftMessage,
    sending: chatModel.sending,
    chatError: chatModel.chatError,
    creatingInvite: memberActions.creatingInvite,
    copyingInvite: memberActions.copyingInvite,
    inviteError: memberActions.inviteError,
    revokingInviteId: memberActions.revokingInviteId,
    removingMemberId: memberActions.removingMemberId,
    updatingRoleMemberId: memberActions.updatingRoleMemberId,
    memberError: memberActions.memberError,
    leavingOrg: memberActions.leavingOrg,
    leaveError: memberActions.leaveError,
    localMetadataError,
    orgMembers,
    selectedMember,
    currentMember,
    currentAccessSettings: accessSettingsModel.currentAccessSettings,
    workspaceOptions: accessSettingsModel.workspaceOptions,
    pendingShareMode: accessSettingsModel.pendingShareMode,
    activeInvites: memberActions.activeInvites,
    latestInvite: memberActions.latestInvite,
    canCreateInvite: memberActions.canCreateInvite,
    sessionItems,
    sessionsTabBanners,
    activeMemberIds,
    orgChatMessages,
    orgProjects,
    orgWorkItems,
    orgSessions,
    latestSnapshotRequest,
    importingSessionId,
    replayingSessionId,
    forkableSessionIds,
    forkingSessionId,
    forkingLinkedSessionId,
    tabs,
    handleSendMessage: chatModel.handleSendMessage,
    handleSelectAccessMode: accessSettingsModel.handleSelectAccessMode,
    handleConfirmShareOnboarding:
      accessSettingsModel.handleConfirmShareOnboarding,
    handleCancelShareOnboarding:
      accessSettingsModel.handleCancelShareOnboarding,
    handleToggleWorkspace: accessSettingsModel.handleToggleWorkspace,
    handleSelectMember,
    handleSelectSession,
    handleForkSession,
    handleOpenWorkItem,
    handleReplayLinkedSession,
    handleForkLinkedSession,
    handleBackToOrg,
    handleOpenSettingsTab,
    handleCreateInvite: memberActions.handleCreateInvite,
    handleCopyInvite: memberActions.handleCopyInvite,
    handleRevokeInvite: memberActions.handleRevokeInvite,
    handleRemoveMember: memberActions.handleRemoveMember,
    handleUpdateMemberRole: memberActions.handleUpdateMemberRole,
    handleLeaveOrg: memberActions.handleLeaveOrg,
  };
}
