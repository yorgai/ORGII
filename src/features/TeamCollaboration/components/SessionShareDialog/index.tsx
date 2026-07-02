/**
 * SessionShareDialog — owner-side per-session sharing (design §6.3).
 *
 * Mounted from the owner's OWN session surfaces (main sidebar context menu +
 * chat panel session header menu — NOT CollabOrgPanelView, which lists
 * teammates' sessions). One section per share-capable org: effective mode,
 * per-session override, org/restricted visibility, directed member shares
 * and one-shot share links with revocation.
 */
import Modal from "@/src/scaffold/ModalSystem";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_SESSION_VISIBILITY,
} from "@src/store/collaboration/types";
import type { CollabOrgRecord } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";
import { formatSmartDateTime } from "@src/util/data/formatters/date";

import {
  SHARE_OVERRIDE_INHERIT,
  type ShareOverrideValue,
  useSessionShareOrgSectionModel,
} from "./useSessionShareOrgSectionModel";

const OVERRIDE_OPTIONS: ShareOverrideValue[] = [
  SHARE_OVERRIDE_INHERIT,
  COLLAB_SESSION_ACCESS_MODE.OFF,
  COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
  COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
];

function pillClass(selected: boolean): string {
  return `rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
    selected
      ? "border-accent-6 bg-accent-2 text-text-1"
      : "border-border-2 bg-bg-2 text-text-3 hover:bg-surface-hover"
  }`;
}

function OrgShareSection({
  t,
  session,
  org,
}: {
  t: TFunction<"navigation">;
  session: Session;
  org: CollabOrgRecord;
}) {
  const model = useSessionShareOrgSectionModel({ session, org });

  const overrideLabel = (value: ShareOverrideValue): string =>
    value === SHARE_OVERRIDE_INHERIT
      ? t("collaboration.share.overrideInherit")
      : t(`collaboration.access.modes.${value}.title`);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-border-2 bg-bg-2 p-3"
      data-testid={`session-share-org-section-${org.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold text-text-1">{org.name}</div>
        <div className="text-[11px] text-text-3">
          {t("collaboration.share.effectiveMode")}:{" "}
          {t(`collaboration.access.modes.${model.effectiveMode}.title`)}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-text-2">
          {t("collaboration.share.overrideLabel")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OVERRIDE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={pillClass(model.overrideValue === option)}
              onClick={() => model.handleSelectOverride(option)}
            >
              {overrideLabel(option)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-text-2">
          {t("collaboration.share.visibilityLabel")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={pillClass(
              model.visibility === COLLAB_SESSION_VISIBILITY.ORG
            )}
            onClick={() =>
              model.handleSelectVisibility(COLLAB_SESSION_VISIBILITY.ORG)
            }
          >
            {t("collaboration.share.visibilityOrg")}
          </button>
          <button
            type="button"
            className={pillClass(
              model.visibility === COLLAB_SESSION_VISIBILITY.RESTRICTED
            )}
            onClick={() =>
              model.handleSelectVisibility(COLLAB_SESSION_VISIBILITY.RESTRICTED)
            }
          >
            {t("collaboration.share.visibilityRestricted")}
          </button>
        </div>
        {model.visibility === COLLAB_SESSION_VISIBILITY.RESTRICTED ? (
          <div className="text-warning-7 rounded-lg bg-warning-1 px-3 py-2 text-[11px]">
            {t("collaboration.share.restrictWarning")}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-text-2">
          {t("collaboration.share.directedTitle")}
        </div>
        {model.grantableMembers.length === 0 ? (
          <div className="text-[11px] text-text-3">
            {t("collaboration.share.directedEmpty")}
          </div>
        ) : (
          <>
            <div className="flex flex-col divide-y divide-border-2 rounded-lg border border-border-2">
              {model.grantableMembers.map((member) => (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] text-text-2 hover:bg-surface-hover"
                >
                  <input
                    type="checkbox"
                    checked={model.selectedMemberIds.includes(member.id)}
                    onChange={() => model.handleToggleMember(member.id)}
                  />
                  <span className="min-w-0 truncate">{member.displayName}</span>
                </label>
              ))}
            </div>
            <div>
              <Button
                htmlType="button"
                size="small"
                loading={model.busy}
                disabled={
                  !model.canShare || model.selectedMemberIds.length === 0
                }
                onClick={() => void model.handleCreateDirectedShares()}
              >
                {t("collaboration.share.createDirected")}
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-text-2">
          {t("collaboration.share.linkTitle")}
        </div>
        <div>
          <Button
            htmlType="button"
            size="small"
            loading={model.busy}
            disabled={!model.canShare}
            onClick={() => void model.handleCreateLinkShare()}
            data-testid="session-share-create-link"
          >
            {t("collaboration.share.createLink")}
          </Button>
        </div>
        {model.createdLink ? (
          <div className="flex flex-col gap-1 rounded-lg bg-fill-1 px-3 py-2">
            <code className="break-all text-[11px] text-text-2">
              {model.createdLink}
            </code>
            <span className="text-[11px] text-text-3">
              {model.createdLinkCopied
                ? t("collaboration.share.linkCopied")
                : t("collaboration.share.linkShownOnce")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] font-medium text-text-2">
          {t("collaboration.share.activeShares")}
        </div>
        {model.shares.length === 0 ? (
          <div className="text-[11px] text-text-3">
            {t("collaboration.share.noShares")}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-2 rounded-lg border border-border-2">
            {model.shares.map((share) => (
              <div
                key={share.id}
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]"
              >
                <span className="min-w-0 truncate text-text-2">
                  {share.granteeMemberId
                    ? (model.memberNameById.get(share.granteeMemberId) ??
                      share.granteeMemberId)
                    : `${t("collaboration.share.linkShareLabel")} #${share.id.slice(-4)}`}
                  <span className="ml-2 text-[11px] text-text-4">
                    {formatSmartDateTime(share.createdAt)}
                  </span>
                </span>
                <Button
                  htmlType="button"
                  variant="secondary"
                  size="small"
                  disabled={model.busy}
                  onClick={() => void model.handleRevokeShare(share.id)}
                >
                  {t("collaboration.share.revoke")}
                </Button>
              </div>
            ))}
          </div>
        )}
        {model.sharesError ? (
          <div className="rounded-lg bg-danger-1 px-3 py-2 text-[11px] text-danger-6">
            {t("collaboration.share.sharesError")}: {model.sharesError}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export interface SessionShareDialogProps {
  /** The owner's local session; null keeps the dialog closed. */
  session: Session | null;
  /** Share-capable orgs for the session (see getShareCapableOrgsForSession). */
  orgs: CollabOrgRecord[];
  onClose: () => void;
}

const SessionShareDialog: React.FC<SessionShareDialogProps> = ({
  session,
  orgs,
  onClose,
}) => {
  const { t } = useTranslation("navigation");

  return (
    <Modal
      visible={session !== null}
      title={t("collaboration.share.dialogTitle")}
      onCancel={onClose}
      footer={null}
      width={520}
    >
      {session ? (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          <div className="text-[12px] text-text-3">
            {session.name || session.user_input || session.session_id}
          </div>
          {orgs.length === 0 ? (
            <div className="text-[12px] text-text-3">
              {t("collaboration.share.noOrgs")}
            </div>
          ) : (
            orgs.map((org) => (
              <OrgShareSection key={org.id} t={t} session={session} org={org} />
            ))
          )}
        </div>
      ) : null}
    </Modal>
  );
};

export default SessionShareDialog;
