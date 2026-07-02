import type { TFunction } from "i18next";
import { Loader2, Play } from "lucide-react";
import React from "react";

import type { EnrichedWorkItem, ProjectData } from "@src/api/http/project";
import { SectionContainer } from "@src/modules/shared/layouts/SectionLayout";
import type {
  CollabMemberRecord,
  RemoteTeammateSessionMetadata,
} from "@src/store/collaboration/types";

import {
  LINKED_SESSION_RESOLUTION,
  resolveLockHolder,
  resolveWorkItemLinkedSessions,
} from "./collabWorkItemLinks";

interface MetadataSectionHeaderProps {
  title: string;
  description: string;
  countLabel: string;
}

function MetadataSectionHeader({
  title,
  description,
  countLabel,
}: MetadataSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[13px] font-semibold text-text-1">{title}</div>
        <div className="mt-1 text-[12px] text-text-3">{description}</div>
      </div>
      <div className="rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
        {countLabel}
      </div>
    </div>
  );
}

function MetadataError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
      {error}
    </div>
  );
}

interface LinkedSessionsProps {
  t: TFunction<"navigation">;
  workItem: EnrichedWorkItem;
  orgId: string;
  remoteSessions: RemoteTeammateSessionMetadata[];
  orgMembers: CollabMemberRecord[];
  replayingSessionId: string | null;
  onReplay: (remoteSession: RemoteTeammateSessionMetadata) => void;
}

/**
 * The §16.7 payoff: each linked session resolves to a shared record and
 * renders either a ▶ replay (segments published) or a muted metadata /
 * unshared state. Clicking replay goes through the shared importer.
 */
function LinkedSessions({
  t,
  workItem,
  orgId,
  remoteSessions,
  orgMembers,
  replayingSessionId,
  onReplay,
}: LinkedSessionsProps) {
  const resolved = resolveWorkItemLinkedSessions(
    workItem,
    orgId,
    remoteSessions
  );
  if (resolved.length === 0) return null;

  return (
    <div
      className="mt-1 flex flex-col gap-1"
      data-testid="collab-work-item-linked-sessions"
    >
      <div className="text-[11px] font-medium text-text-3">
        {t("collaboration.workitem.linkedSessionsTitle")}
      </div>
      {resolved.map((entry) => {
        const owner =
          entry.ownerDisplayName ??
          orgMembers.find(
            (member) => member.id === entry.remoteSession?.ownerMemberId
          )?.displayName ??
          t("collaboration.workitem.unknownOwner");
        const role = entry.linked.agent_role;
        const status = entry.linked.status;
        const isReplayable = entry.kind === LINKED_SESSION_RESOLUTION.REPLAY;
        const isReplaying =
          replayingSessionId === entry.linked.session_id &&
          Boolean(entry.remoteSession);

        return (
          <div
            key={entry.linked.session_id}
            className="flex items-center justify-between gap-2 rounded-lg bg-fill-1 px-2.5 py-1.5"
            data-testid={`collab-linked-session-${entry.linked.session_id}`}
          >
            <div className="flex min-w-0 flex-col">
              <div className="truncate text-[12px] text-text-1">{owner}</div>
              <div className="truncate text-[11px] text-text-3">
                {role} &middot; {status}
              </div>
            </div>
            {isReplayable && entry.remoteSession ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-6 disabled:opacity-60"
                disabled={isReplaying}
                onClick={() => onReplay(entry.remoteSession!)}
                data-testid={`collab-linked-session-replay-${entry.linked.session_id}`}
              >
                {isReplaying ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Play size={11} />
                )}
                {t("collaboration.workitem.replay")}
              </button>
            ) : (
              <span
                className="shrink-0 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] text-text-4"
                data-testid={`collab-linked-session-unshared-${entry.linked.session_id}`}
              >
                {entry.kind === LINKED_SESSION_RESOLUTION.METADATA
                  ? t("collaboration.workitem.linkedSessionMetadataOnly")
                  : t("collaboration.workitem.linkedSessionUnshared")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface WorkItemsSectionProps {
  t: TFunction<"navigation">;
  workItems: EnrichedWorkItem[];
  localMetadataError: string | null;
  orgId: string;
  remoteSessions: RemoteTeammateSessionMetadata[];
  orgMembers: CollabMemberRecord[];
  currentMemberId: string | undefined;
  replayingSessionId: string | null;
  onOpenWorkItem: (workItem: EnrichedWorkItem) => void;
  onReplayLinkedSession: (remoteSession: RemoteTeammateSessionMetadata) => void;
}

// Typed native rows (design §16.2): shared work items live in the local
// project store. M6b makes them actionable — a row opens the ProjectManager
// detail (§16.9: any member may open/edit) and exposes linked-session replay
// (§16.7) + the execution-lock holder (§16.6).
export function WorkItemsSection({
  t,
  workItems,
  localMetadataError,
  orgId,
  remoteSessions,
  orgMembers,
  currentMemberId,
  replayingSessionId,
  onOpenWorkItem,
  onReplayLinkedSession,
}: WorkItemsSectionProps) {
  return (
    <SectionContainer color="chatPanelInfo" padding="default">
      <div className="flex min-h-[320px] flex-col gap-3">
        <MetadataSectionHeader
          title={t("collaboration.workItems.title")}
          description={t("collaboration.workItems.description")}
          countLabel={t("collaboration.workItems.count", {
            count: workItems.length,
          })}
        />
        <MetadataError error={localMetadataError} />
        {workItems.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-lg bg-fill-1 px-4 text-center text-[13px] text-text-3">
            {t("collaboration.workItems.empty")}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
            {workItems.map((workItem) => {
              const lockHolder = resolveLockHolder(
                workItem.executionLock?.lockedByMemberId,
                currentMemberId,
                orgMembers
              );
              return (
                <div
                  key={workItem.id}
                  className="flex flex-col gap-2 px-3 py-3"
                  data-testid={`collab-work-item-${workItem.id}`}
                >
                  <button
                    type="button"
                    className="flex items-start justify-between gap-3 text-left"
                    onClick={() => onOpenWorkItem(workItem)}
                    data-testid={`collab-work-item-open-${workItem.id}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-text-1 hover:underline">
                        {workItem.title || workItem.shortId}
                      </div>
                      <div className="mt-1 truncate text-[12px] text-text-3">
                        {workItem.project?.name ?? workItem.shortId}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
                      {workItem.status}
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-1.5 text-[11px] text-text-3">
                    <span className="rounded-full bg-fill-1 px-2 py-0.5">
                      {workItem.priority}
                    </span>
                    <span className="rounded-full bg-fill-1 px-2 py-0.5">
                      {workItem.assignee?.name ??
                        t("collaboration.workItems.unassigned")}
                    </span>
                    {lockHolder.heldByOther ? (
                      <span
                        className="text-warning-7 rounded-full bg-warning-1 px-2 py-0.5"
                        data-testid={`collab-work-item-lock-${workItem.id}`}
                      >
                        {t("collaboration.lock.heldBy", {
                          name: lockHolder.holderName ?? "",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <LinkedSessions
                    t={t}
                    workItem={workItem}
                    orgId={orgId}
                    remoteSessions={remoteSessions}
                    orgMembers={orgMembers}
                    replayingSessionId={replayingSessionId}
                    onReplay={onReplayLinkedSession}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionContainer>
  );
}

interface ProjectsSectionProps {
  t: TFunction<"navigation">;
  projects: ProjectData[];
  localMetadataError: string | null;
}

export function ProjectsSection({
  t,
  projects,
  localMetadataError,
}: ProjectsSectionProps) {
  return (
    <SectionContainer color="chatPanelInfo" padding="default">
      <div className="flex min-h-[320px] flex-col gap-3">
        <MetadataSectionHeader
          title={t("collaboration.projects.title")}
          description={t("collaboration.projects.description")}
          countLabel={t("collaboration.projects.count", {
            count: projects.length,
          })}
        />
        <MetadataError error={localMetadataError} />
        {projects.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-lg bg-fill-1 px-4 text-center text-[13px] text-text-3">
            {t("collaboration.projects.empty")}
          </div>
        ) : (
          <div className="grid gap-3 @[720px]:grid-cols-2">
            {projects.map((project) => (
              <div
                key={project.meta.id}
                className="rounded-xl border border-border-2 bg-bg-2 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text-1">
                      {project.meta.name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] text-text-3">
                      {project.description ||
                        t("collaboration.projects.noDescription")}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
                    {project.meta.status}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-text-3">
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {project.meta.priority}
                  </span>
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {project.meta.health}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionContainer>
  );
}
