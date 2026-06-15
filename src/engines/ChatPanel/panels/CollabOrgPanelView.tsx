import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import TabPill from "@src/components/TabPill";
import {
  createCollabInvite,
  listCollabChatMessages,
  postCollabChatMessage,
} from "@src/features/TeamCollaboration/collabHubClient";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import WorkItemContentStack from "@src/modules/ProjectManager/WorkItems/components/WorkItemContentStack";
import { SectionContainer } from "@src/modules/shared/layouts/SectionLayout";
import {
  DETAIL_PANEL_TOKENS,
  DetailPanelContainer,
  SessionTable,
} from "@src/modules/shared/layouts/blocks";
import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import {
  collabChatMessagesAtom,
  collabInvitesAtom,
  collabMembersAtom,
  collabOrgsAtom,
  remoteTeammateSessionsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import {
  COLLAB_CONNECTION_STATUS,
  COLLAB_IDENTITY_KIND,
  COLLAB_ROLE,
} from "@src/store/collaboration/types";
import type {
  CollabChatMessageRecord,
  CollabInviteRecord,
  CollabMemberRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";
import type { ChatPanelSelectedCollabOrg } from "@src/store/ui/chatPanelAtom";
import { chatPanelSelectedCollabOrgAtom } from "@src/store/ui/chatPanelAtom";
import { copyText } from "@src/util/data/clipboard";
import { formatSmartDateTime } from "@src/util/data/formatters/date";

const COLLAB_ORG_TAB = {
  SESSIONS: "sessions",
  MEMBERS: "members",
  CHAT: "chat",
} as const;

type CollabOrgTab = (typeof COLLAB_ORG_TAB)[keyof typeof COLLAB_ORG_TAB];

const CHAT_HISTORY_LIMIT = 100;

const SESSION_STATUS_COLOR = {
  [COLLAB_CONNECTION_STATUS.CONNECTED]: "var(--color-success-6)",
  [COLLAB_CONNECTION_STATUS.CONNECTING]: "var(--color-warning-6)",
  [COLLAB_CONNECTION_STATUS.DISCONNECTED]: "var(--color-text-4)",
  [COLLAB_CONNECTION_STATUS.ERROR]: "var(--color-danger-6)",
} as const;

function createLocalChatMessageId(orgId: string): string {
  return `${orgId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

interface CollabOrgPanelViewProps {
  selectedCollabOrg: ChatPanelSelectedCollabOrg;
}

function formatSessionDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return formatSmartDateTime(value);
}

function isToday(value: string | undefined): boolean {
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

function toSessionTableItem(
  session: RemoteTeammateSessionMetadata,
  fallbackStatusLabel: string
): SessionTableItem {
  return {
    id: session.id,
    title: session.title,
    description: session.ownerDisplayName,
    statusLabel: session.status ?? fallbackStatusLabel,
    statusColor: SESSION_STATUS_COLOR[COLLAB_CONNECTION_STATUS.CONNECTED],
    agentLabel: session.ownerDisplayName,
    workspaceLabel: session.repoPath,
    workspaceTitle: session.repoPath,
    modelLabel: session.branch,
    startedLabel: formatSessionDate(session.lastActivityAt),
    lastUpdatedLabel: formatSessionDate(session.lastActivityAt),
  };
}

function upsertChatMessage(
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

function upsertInvite(
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

function MemberStatusPill({
  active,
  label,
}: {
  active: boolean;
  label: string;
}): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-success-6" : "bg-fill-4"
        }`}
      />
      {label}
    </span>
  );
}

export const CollabOrgPanelView: React.FC<CollabOrgPanelViewProps> = ({
  selectedCollabOrg,
}) => {
  const { t } = useTranslation("navigation");
  const orgs = useAtomValue(collabOrgsAtom);
  const members = useAtomValue(collabMembersAtom);
  const sessions = useAtomValue(sessionsAtom);
  const remoteSessions = useAtomValue(remoteTeammateSessionsAtom);
  const { openSession } = useSessionView();
  const [chatMessages, setChatMessages] = useAtom(collabChatMessagesAtom);
  const [invites, setInvites] = useAtom(collabInvitesAtom);
  const setSelectedCollabOrg = useSetAtom(chatPanelSelectedCollabOrgAtom);
  const [activeTab, setActiveTab] = useState<CollabOrgTab>(
    selectedCollabOrg.memberId
      ? COLLAB_ORG_TAB.MEMBERS
      : COLLAB_ORG_TAB.SESSIONS
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copyingInvite, setCopyingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
        ? orgMembers.find((member) => member.id === selectedCollabOrg.memberId)
        : null,
    [orgMembers, selectedCollabOrg.memberId]
  );
  const currentMember = useMemo(
    () => orgMembers.find((member) => member.accessToken),
    [orgMembers]
  );
  const latestInvite = useMemo(
    () =>
      invites
        .filter(
          (invite) =>
            invite.orgId === selectedCollabOrg.orgId && !invite.revokedAt
        )
        .sort((left, right) =>
          right.createdAt.localeCompare(left.createdAt)
        )[0],
    [invites, selectedCollabOrg.orgId]
  );
  const canCreateInvite =
    Boolean(org?.hubUrl && currentMember?.accessToken) &&
    currentMember?.role === COLLAB_ROLE.ADMIN;
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
        toSessionTableItem(session, t("collaboration.sessionStatusActive"))
      ),
    [visibleSessions, t]
  );
  const activeMemberIds = new Set(
    orgSessions
      .filter((session) => isToday(session.lastActivityAt))
      .map((session) => session.ownerMemberId)
  );
  const orgChatMessages = useMemo(
    () =>
      chatMessages
        .filter((message) => message.orgId === selectedCollabOrg.orgId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [chatMessages, selectedCollabOrg.orgId]
  );

  useEffect(() => {
    if (!org?.hubUrl || !currentMember?.accessToken) return;
    let cancelled = false;
    listCollabChatMessages({
      hubUrl: org.hubUrl,
      orgId: org.id,
      accessToken: currentMember.accessToken,
      limit: CHAT_HISTORY_LIMIT,
    })
      .then((messages) => {
        if (cancelled) return;
        setChatMessages((current) =>
          messages.reduce(upsertChatMessage, current)
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setChatError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [currentMember?.accessToken, org?.hubUrl, org?.id, setChatMessages]);

  const handleSendMessage = useCallback(async () => {
    const body = draftMessage.trim();
    if (!body || !org || sending) return;
    setSending(true);
    setChatError(null);
    try {
      if (org.hubUrl && currentMember?.accessToken) {
        const message = await postCollabChatMessage({
          hubUrl: org.hubUrl,
          orgId: org.id,
          accessToken: currentMember.accessToken,
          body,
        });
        setChatMessages((current) => upsertChatMessage(current, message));
      } else {
        const author =
          currentMember ??
          orgMembers.find(
            (member) => member.identityKind === COLLAB_IDENTITY_KIND.HUMAN
          ) ??
          orgMembers[0];
        const message: CollabChatMessageRecord = {
          id: createLocalChatMessageId(org.id),
          orgId: org.id,
          authorMemberId: author?.id ?? "local-human",
          authorDisplayName:
            author?.displayName ?? t("collaboration.localHuman"),
          authorIdentityKind:
            author?.identityKind ?? COLLAB_IDENTITY_KIND.HUMAN,
          body,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((current) => upsertChatMessage(current, message));
      }
      setDraftMessage("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }, [
    currentMember,
    draftMessage,
    org,
    orgMembers,
    sending,
    setChatMessages,
    t,
  ]);

  const handleSelectMember = useCallback(
    (member: CollabMemberRecord) => {
      setSelectedCollabOrg({ orgId: member.orgId, memberId: member.id });
      setActiveTab(COLLAB_ORG_TAB.MEMBERS);
    },
    [setSelectedCollabOrg]
  );

  const handleSelectSession = useCallback(
    (item: SessionTableItem) => {
      const remoteSession = orgSessions.find(
        (session) => session.id === item.id
      );
      if (!remoteSession) return;

      const localSession = sessions.find(
        (session) =>
          session.session_id === remoteSession.sourceSessionId ||
          session.session_id === remoteSession.id
      );

      if (localSession) {
        openSession(
          localSession.session_id,
          localSession.name || localSession.user_input || remoteSession.title,
          localSession.repoPath ?? remoteSession.repoPath
        );
        return;
      }

      setSelectedCollabOrg({
        orgId: remoteSession.orgId,
        memberId: remoteSession.ownerMemberId,
      });
      setActiveTab(COLLAB_ORG_TAB.SESSIONS);
    },
    [openSession, orgSessions, sessions, setSelectedCollabOrg]
  );

  const handleBackToOrg = useCallback(() => {
    setSelectedCollabOrg({ orgId: selectedCollabOrg.orgId });
    setActiveTab(COLLAB_ORG_TAB.SESSIONS);
  }, [selectedCollabOrg.orgId, setSelectedCollabOrg]);

  const handleCreateInvite = useCallback(async () => {
    if (!org?.hubUrl || !currentMember?.accessToken || creatingInvite) return;
    setCreatingInvite(true);
    setInviteError(null);
    try {
      const invite = await createCollabInvite({
        hubUrl: org.hubUrl,
        orgId: org.id,
        accessToken: currentMember.accessToken,
      });
      setInvites((current) => upsertInvite(current, invite));
      await copyText(invite.inviteLink);
      setCopyingInvite(true);
      window.setTimeout(() => setCopyingInvite(false), 1500);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingInvite(false);
    }
  }, [creatingInvite, currentMember?.accessToken, org, setInvites]);

  const handleCopyInvite = useCallback(async () => {
    if (!latestInvite?.inviteLink || copyingInvite) return;
    setInviteError(null);
    try {
      await copyText(latestInvite.inviteLink);
      setCopyingInvite(true);
      window.setTimeout(() => setCopyingInvite(false), 1500);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : String(error));
    }
  }, [copyingInvite, latestInvite?.inviteLink]);

  const tabs = useMemo(
    () => [
      { key: COLLAB_ORG_TAB.SESSIONS, label: t("collaboration.tabs.sessions") },
      { key: COLLAB_ORG_TAB.MEMBERS, label: t("collaboration.tabs.members") },
      { key: COLLAB_ORG_TAB.CHAT, label: t("collaboration.tabs.chat") },
    ],
    [t]
  );

  if (!org) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-text-3">
        {t("collaboration.orgNotFound")}
      </div>
    );
  }

  const descriptionContent = (
    <section
      className={`${DETAIL_PANEL_TOKENS.contentWidth} flex flex-col`}
      data-testid="chat-panel-collab-org-section"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <TabPill
          tabs={tabs}
          activeTab={activeTab}
          onChange={(tab) => setActiveTab(tab as CollabOrgTab)}
          variant="simple"
          size="large"
          fillWidth={false}
        />
        {selectedMember ? (
          <Button htmlType="button" size="small" onClick={handleBackToOrg}>
            {t("collaboration.backToOrg")}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {activeTab === COLLAB_ORG_TAB.SESSIONS ? (
          <SessionTable
            items={sessionItems}
            onSelect={handleSelectSession}
            showSearch
            surfaceVariant="chatPanel"
            maxHeight={520}
            pageSize={10}
            pageSizeOptions={[10, 25, 50]}
          />
        ) : null}

        {activeTab === COLLAB_ORG_TAB.MEMBERS ? (
          <>
            {!selectedMember ? (
              <SectionContainer color="chatPanelInfo" padding="none">
                <div className="flex flex-col gap-3 p-4 @[720px]:flex-row @[720px]:items-center @[720px]:justify-between">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text-1">
                      {t("collaboration.invite.title")}
                    </div>
                    {!canCreateInvite ? (
                      <div className="mt-1 text-[12px] text-text-3">
                        {t("collaboration.invite.adminOnly")}
                      </div>
                    ) : null}
                    {latestInvite ? (
                      <div className="mt-2 select-text break-all rounded-lg bg-fill-1 px-3 py-2 text-[12px] text-text-2">
                        {latestInvite.inviteLink}
                      </div>
                    ) : null}
                    {inviteError ? (
                      <div className="mt-2 text-[12px] text-danger-6">
                        {inviteError}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {latestInvite ? (
                      <Button
                        htmlType="button"
                        size="small"
                        disabled={copyingInvite}
                        onClick={() => void handleCopyInvite()}
                      >
                        {copyingInvite
                          ? t("collaboration.copiedInvite")
                          : t("collaboration.copyInvite")}
                      </Button>
                    ) : null}
                    <Button
                      htmlType="button"
                      size="small"
                      variant="primary"
                      disabled={!canCreateInvite || creatingInvite}
                      loading={creatingInvite}
                      onClick={() => void handleCreateInvite()}
                    >
                      {latestInvite
                        ? t("collaboration.invite.createNew")
                        : t("collaboration.invite.create")}
                    </Button>
                  </div>
                </div>
              </SectionContainer>
            ) : null}

            <SectionContainer color="chatPanelInfo" padding="default">
              <div className="flex flex-col divide-y divide-border-2">
                {orgMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-surface-hover"
                    onClick={() => handleSelectMember(member)}
                  >
                    <span className="min-w-0 px-3 text-[13px] font-medium text-text-1">
                      {member.displayName}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 px-3 text-[12px] text-text-3">
                      <span>{member.identityKind}</span>
                      <span>·</span>
                      <span>{member.role}</span>
                      <MemberStatusPill
                        active={activeMemberIds.has(member.id)}
                        label={
                          activeMemberIds.has(member.id)
                            ? t("collaboration.status.activeToday")
                            : t("collaboration.status.idle")
                        }
                      />
                    </span>
                  </button>
                ))}
              </div>
            </SectionContainer>
          </>
        ) : null}

        {activeTab === COLLAB_ORG_TAB.CHAT ? (
          <SectionContainer color="chatPanelInfo" padding="default">
            <div className="flex min-h-[320px] flex-col gap-3">
              <div className="text-[12px] text-text-3">
                {t("collaboration.chat.hint")}
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-fill-1 p-3">
                {orgChatMessages.length === 0 ? (
                  <div className="flex h-full min-h-[160px] items-center justify-center text-[13px] text-text-3">
                    {t("collaboration.chat.empty")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {orgChatMessages.map((message) => (
                      <div
                        key={message.id}
                        className="rounded-lg bg-bg-2 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-text-3">
                          <span className="font-medium text-text-2">
                            {message.authorDisplayName}
                          </span>
                          <span>{formatSessionDate(message.createdAt)}</span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap break-words text-[13px] text-text-1">
                          {message.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {chatError ? (
                <div className="text-[12px] text-danger-6">{chatError}</div>
              ) : null}
              {currentMember?.identityKind === COLLAB_IDENTITY_KIND.AGENT ? (
                <div className="text-[12px] text-text-3">
                  {t("collaboration.chat.humanOnly")}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={draftMessage}
                    onChange={setDraftMessage}
                    placeholder={t("collaboration.chat.placeholder")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                  />
                  <Button
                    htmlType="button"
                    variant="primary"
                    disabled={!draftMessage.trim() || sending}
                    loading={sending}
                    onClick={() => void handleSendMessage()}
                  >
                    {t("collaboration.chat.send")}
                  </Button>
                </div>
              )}
            </div>
          </SectionContainer>
        ) : null}
      </div>
    </section>
  );

  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="chat-panel-collab-org-detail"
    >
      <DetailPanelContainer testId="collab-org-panel">
        <WorkItemContentStack
          descriptionContent={descriptionContent}
          descriptionFlexible
          scrollable
        />
      </DetailPanelContainer>
    </div>
  );
};

export default CollabOrgPanelView;
