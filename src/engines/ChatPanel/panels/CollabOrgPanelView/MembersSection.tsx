import type { TFunction } from "i18next";
import React, { useMemo, useState } from "react";

import Button from "@src/components/Button";
import Checkbox from "@src/components/Checkbox";
import Select from "@src/components/Select";
import { getSyncProfile } from "@src/features/TeamCollaboration/collabSyncUtils";
import { SectionContainer } from "@src/modules/shared/layouts/SectionLayout";
import {
  DEFAULT_INVITE_EXPIRY_DAYS,
  PANEL_INVITE_USAGE_LIMIT,
} from "@src/store/collaboration/inviteDefaults";
import { COLLAB_ROLE } from "@src/store/collaboration/types";
import type {
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
  CollabRole,
} from "@src/store/collaboration/types";

import type { CreateInviteOptions } from "./useMemberActions";
import { formatSessionDate, getInviteRemainingUses } from "./utils";

const INVITE_USAGE_LIMIT_OPTIONS = [1, 5, 10, 25] as const;
const INVITE_EXPIRY_DAY_OPTIONS = [1, 7, 30] as const;
const INVITE_SELECT_STYLE = { minWidth: 88 } as const;

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

function InviteRoleBadge({
  t,
  role,
}: {
  t: TFunction<"navigation">;
  role: CollabRole | undefined;
}): React.ReactNode {
  return (
    <span className="inline-flex items-center rounded-full bg-fill-2 px-2 py-0.5 text-[11px] font-medium text-text-2">
      {role === COLLAB_ROLE.ADMIN
        ? t("collaboration.invites.roleAdmin")
        : t("collaboration.invites.roleMember")}
    </span>
  );
}

interface InvitesCardProps {
  t: TFunction<"navigation">;
  activeInvites: CollabInviteRecord[];
  memberNameById: Map<string, string>;
  latestInvite: CollabInviteRecord | undefined;
  canCreateInvite: boolean;
  creatingInvite: boolean;
  copyingInvite: boolean;
  inviteError: string | null;
  revokingInviteId: string | null;
  onCreateInvite: (options: CreateInviteOptions) => void;
  onCopyInvite: (invite?: CollabInviteRecord) => void;
  onRevokeInvite: (invite: CollabInviteRecord) => void;
}

function InvitesCard({
  t,
  activeInvites,
  memberNameById,
  latestInvite,
  canCreateInvite,
  creatingInvite,
  copyingInvite,
  inviteError,
  revokingInviteId,
  onCreateInvite,
  onCopyInvite,
  onRevokeInvite,
}: InvitesCardProps) {
  const [usageLimit, setUsageLimit] = useState<number>(
    PANEL_INVITE_USAGE_LIMIT
  );
  const [expiresInDays, setExpiresInDays] = useState<number>(
    DEFAULT_INVITE_EXPIRY_DAYS
  );
  const [role, setRole] = useState<CollabRole>(COLLAB_ROLE.MEMBER);

  const usageOptions = useMemo(
    () =>
      INVITE_USAGE_LIMIT_OPTIONS.map((limit) => ({
        value: limit,
        label: String(limit),
      })),
    []
  );
  const expiryOptions = useMemo(
    () =>
      INVITE_EXPIRY_DAY_OPTIONS.map((days) => ({
        value: days,
        label:
          days === 1
            ? t("collaboration.invites.expiryOption1d")
            : t(
                days === 7
                  ? "collaboration.invites.expiryOption7d"
                  : "collaboration.invites.expiryOption30d"
              ),
      })),
    [t]
  );
  const roleOptions = useMemo(
    () => [
      {
        value: COLLAB_ROLE.MEMBER,
        label: t("collaboration.invites.roleMember"),
      },
      { value: COLLAB_ROLE.ADMIN, label: t("collaboration.invites.roleAdmin") },
    ],
    [t]
  );

  const handleRevoke = (invite: CollabInviteRecord) => {
    if (!window.confirm(t("collaboration.invites.revokeConfirm"))) return;
    onRevokeInvite(invite);
  };

  return (
    <SectionContainer color="chatPanelInfo" padding="none">
      <div className="flex flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-text-1">
            {t("collaboration.invites.title")}
          </div>
          {!canCreateInvite ? (
            <div className="mt-1 text-[12px] text-text-3">
              {t("collaboration.invites.adminOnly")}
            </div>
          ) : null}
        </div>

        {canCreateInvite ? (
          <>
            <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
              {activeInvites.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-text-3">
                  {t("collaboration.invites.empty")}
                </div>
              ) : (
                activeInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-text-1">
                          {t("collaboration.invites.code", {
                            suffix: invite.codeSuffix ?? "????",
                          })}
                        </span>
                        <InviteRoleBadge t={t} role={invite.role} />
                      </div>
                      <div className="text-[11px] text-text-3">
                        {t("collaboration.invite.remainingUses", {
                          count: getInviteRemainingUses(invite),
                        })}
                        {invite.expiresAt
                          ? ` · ${t("collaboration.invite.expires", {
                              date: formatSessionDate(invite.expiresAt),
                            })}`
                          : ` · ${t("collaboration.invites.neverExpires")}`}
                        {invite.createdByMemberId
                          ? ` · ${t("collaboration.invites.createdBy", {
                              member:
                                memberNameById.get(invite.createdByMemberId) ??
                                invite.createdByMemberId,
                            })}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {invite.inviteLink ? (
                        <Button
                          htmlType="button"
                          size="mini"
                          disabled={copyingInvite}
                          onClick={() => void onCopyInvite(invite)}
                        >
                          {copyingInvite
                            ? t("collaboration.copiedInvite")
                            : t("collaboration.copyInvite")}
                        </Button>
                      ) : null}
                      <Button
                        htmlType="button"
                        size="mini"
                        variant="danger"
                        appearance="ghost"
                        disabled={Boolean(revokingInviteId)}
                        loading={revokingInviteId === invite.id}
                        onClick={() => handleRevoke(invite)}
                      >
                        {t("collaboration.invites.revoke")}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {latestInvite?.inviteLink ? (
              <div className="rounded-lg bg-fill-1 px-3 py-2">
                <div className="select-text break-all text-[12px] text-text-2">
                  {latestInvite.inviteLink}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-text-3">
                {t("collaboration.invites.usageLimitLabel")}
                <Select
                  size="mini"
                  value={usageLimit}
                  options={usageOptions}
                  style={INVITE_SELECT_STYLE}
                  onChange={(value) => setUsageLimit(Number(value))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-3">
                {t("collaboration.invites.expiryLabel")}
                <Select
                  size="mini"
                  value={expiresInDays}
                  options={expiryOptions}
                  style={INVITE_SELECT_STYLE}
                  onChange={(value) => setExpiresInDays(Number(value))}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-text-3">
                {t("collaboration.invites.roleLabel")}
                <Select
                  size="mini"
                  value={role}
                  options={roleOptions}
                  style={INVITE_SELECT_STYLE}
                  onChange={(value) => setRole(value as CollabRole)}
                />
              </label>
              <Button
                htmlType="button"
                size="small"
                variant="primary"
                disabled={creatingInvite}
                loading={creatingInvite}
                onClick={() =>
                  void onCreateInvite({ usageLimit, expiresInDays, role })
                }
              >
                {t("collaboration.invites.create")}
              </Button>
            </div>
          </>
        ) : null}

        {inviteError ? (
          <div className="text-[12px] text-danger-6">{inviteError}</div>
        ) : null}
      </div>
    </SectionContainer>
  );
}

interface LeaveOrgConfirmProps {
  t: TFunction<"navigation">;
  leavingOrg: boolean;
  onConfirm: (removeImportedCopies: boolean) => void;
  onCancel: () => void;
}

function LeaveOrgConfirm({
  t,
  leavingOrg,
  onConfirm,
  onCancel,
}: LeaveOrgConfirmProps) {
  // Default keeps imported copies (design §8.4): removal is the opt-in.
  const [removeImportedCopies, setRemoveImportedCopies] = useState(false);
  return (
    <div className="mx-3 my-2 flex flex-col gap-2 rounded-xl border border-danger-3 bg-bg-2 px-3 py-3">
      <div className="text-[13px] font-semibold text-text-1">
        {t("collaboration.leave.confirmTitle")}
      </div>
      <div className="text-[12px] text-text-3">
        {t("collaboration.leave.warning")}
      </div>
      <Checkbox
        checked={removeImportedCopies}
        onChange={(checked: boolean) => setRemoveImportedCopies(checked)}
      >
        <span className="text-[12px] text-text-2">
          {t("collaboration.leave.removeImported")}
        </span>
      </Checkbox>
      <div className="flex items-center gap-2">
        <Button
          htmlType="button"
          size="small"
          variant="danger"
          disabled={leavingOrg}
          loading={leavingOrg}
          onClick={() => onConfirm(removeImportedCopies)}
        >
          {t("collaboration.leave.confirm")}
        </Button>
        <Button
          htmlType="button"
          size="small"
          variant="secondary"
          disabled={leavingOrg}
          onClick={onCancel}
        >
          {t("collaboration.leave.cancel")}
        </Button>
      </div>
    </div>
  );
}

interface MembersSectionProps {
  t: TFunction<"navigation">;
  org: CollabOrgRecord;
  orgMembers: CollabMemberRecord[];
  selectedMember: CollabMemberRecord | null;
  currentMember: CollabMemberRecord | undefined;
  activeMemberIds: Set<string>;
  activeInvites: CollabInviteRecord[];
  latestInvite: CollabInviteRecord | undefined;
  canCreateInvite: boolean;
  creatingInvite: boolean;
  copyingInvite: boolean;
  inviteError: string | null;
  revokingInviteId: string | null;
  memberError: string | null;
  removingMemberId: string | null;
  updatingRoleMemberId: string | null;
  leavingOrg: boolean;
  leaveError: string | null;
  onCreateInvite: (options: CreateInviteOptions) => void;
  onCopyInvite: (invite?: CollabInviteRecord) => void;
  onRevokeInvite: (invite: CollabInviteRecord) => void;
  onSelectMember: (member: CollabMemberRecord) => void;
  onRemoveMember: (member: CollabMemberRecord) => void;
  onUpdateMemberRole: (member: CollabMemberRecord, role: CollabRole) => void;
  onLeaveOrg: (removeImportedCopies: boolean) => void;
}

export function MembersSection({
  t,
  org,
  orgMembers,
  selectedMember,
  currentMember,
  activeMemberIds,
  activeInvites,
  latestInvite,
  canCreateInvite,
  creatingInvite,
  copyingInvite,
  inviteError,
  revokingInviteId,
  memberError,
  removingMemberId,
  updatingRoleMemberId,
  leavingOrg,
  leaveError,
  onCreateInvite,
  onCopyInvite,
  onRevokeInvite,
  onSelectMember,
  onRemoveMember,
  onUpdateMemberRole,
  onLeaveOrg,
}: MembersSectionProps) {
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of orgMembers) map.set(member.id, member.displayName);
    return map;
  }, [orgMembers]);

  const hasSyncProfile = getSyncProfile(org) !== null;
  const viewerIsAdmin = currentMember?.role === COLLAB_ROLE.ADMIN;

  const handleRoleChange = (member: CollabMemberRecord) => {
    const promote = member.role !== COLLAB_ROLE.ADMIN;
    const confirmed = window.confirm(
      t(
        promote
          ? "collaboration.members.roleChangeConfirmPromote"
          : "collaboration.members.roleChangeConfirmDemote",
        { member: member.displayName }
      )
    );
    if (!confirmed) return;
    onUpdateMemberRole(
      member,
      promote ? COLLAB_ROLE.ADMIN : COLLAB_ROLE.MEMBER
    );
  };

  return (
    <>
      {!selectedMember ? (
        <InvitesCard
          t={t}
          activeInvites={activeInvites}
          memberNameById={memberNameById}
          latestInvite={latestInvite}
          canCreateInvite={canCreateInvite}
          creatingInvite={creatingInvite}
          copyingInvite={copyingInvite}
          inviteError={inviteError}
          revokingInviteId={revokingInviteId}
          onCreateInvite={onCreateInvite}
          onCopyInvite={onCopyInvite}
          onRevokeInvite={onRevokeInvite}
        />
      ) : null}

      <SectionContainer color="chatPanelInfo" padding="default">
        <div className="flex flex-col divide-y divide-border-2">
          {memberError ? (
            <div className="px-3 pb-2 text-[12px] text-danger-6">
              {memberError}
            </div>
          ) : null}
          {orgMembers.map((member) => {
            const isSelf = currentMember?.id === member.id;
            const canManageMember = viewerIsAdmin && !isSelf && hasSyncProfile;
            const canLeave = isSelf && hasSyncProfile;
            const active = activeMemberIds.has(member.id);
            return (
              <div key={member.id} className="flex w-full flex-col">
                <div className="flex w-full items-center justify-between gap-3 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left transition-colors hover:bg-surface-hover"
                    onClick={() => onSelectMember(member)}
                  >
                    <span className="min-w-0 text-[13px] font-medium text-text-1">
                      {member.displayName}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-[12px] text-text-3">
                      <span>{member.identityKind}</span>
                      <span>·</span>
                      <span>{member.role}</span>
                      <MemberStatusPill
                        active={active}
                        label={
                          active
                            ? t("collaboration.status.activeToday")
                            : t("collaboration.status.idle")
                        }
                      />
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {canManageMember ? (
                      <>
                        <Button
                          htmlType="button"
                          size="mini"
                          appearance="ghost"
                          disabled={Boolean(updatingRoleMemberId)}
                          loading={updatingRoleMemberId === member.id}
                          onClick={() => handleRoleChange(member)}
                        >
                          {member.role === COLLAB_ROLE.ADMIN
                            ? t("collaboration.members.makeMember")
                            : t("collaboration.members.makeAdmin")}
                        </Button>
                        <Button
                          htmlType="button"
                          size="mini"
                          variant="danger"
                          appearance="ghost"
                          disabled={Boolean(removingMemberId)}
                          loading={removingMemberId === member.id}
                          onClick={() => void onRemoveMember(member)}
                        >
                          {t("collaboration.members.remove")}
                        </Button>
                      </>
                    ) : null}
                    {canLeave ? (
                      <Button
                        htmlType="button"
                        size="mini"
                        variant="danger"
                        appearance="ghost"
                        disabled={leavingOrg || confirmingLeave}
                        onClick={() => setConfirmingLeave(true)}
                      >
                        {t("collaboration.leave.action")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {isSelf && confirmingLeave ? (
                  <LeaveOrgConfirm
                    t={t}
                    leavingOrg={leavingOrg}
                    onConfirm={(removeImportedCopies) =>
                      void onLeaveOrg(removeImportedCopies)
                    }
                    onCancel={() => setConfirmingLeave(false)}
                  />
                ) : null}
                {isSelf && leaveError ? (
                  <div className="px-3 pb-2 text-[12px] text-danger-6">
                    {leaveError}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SectionContainer>
    </>
  );
}
