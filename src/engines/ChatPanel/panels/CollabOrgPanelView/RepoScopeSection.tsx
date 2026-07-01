import type { TFunction } from "i18next";
import React, { useMemo, useState } from "react";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { SectionContainer } from "@src/modules/shared/layouts/SectionLayout";
import { COLLAB_REPO_JOIN_STATUS } from "@src/store/collaboration/types";
import type {
  CollabMemberRecord,
  CollabOrgRecord,
  CollabRepoJoinRequestRecord,
} from "@src/store/collaboration/types";

interface RepoScopeSectionProps {
  t: TFunction<"navigation">;
  org: CollabOrgRecord;
  currentMember: CollabMemberRecord | undefined;
  isAdmin: boolean;
  orgJoinRequests: CollabRepoJoinRequestRecord[];
  pendingJoinRequests: CollabRepoJoinRequestRecord[];
  memberNameById: Map<string, string>;
  submittingJoin: boolean;
  joinError: string | null;
  joinSubmitted: boolean;
  reviewingRequestId: string | null;
  reviewError: string | null;
  savingScopes: boolean;
  scopesError: string | null;
  scopesSaved: boolean;
  onRequestRepoJoin: (repoPath: string) => void;
  onReviewRepoJoin: (
    request: CollabRepoJoinRequestRecord,
    approve: boolean
  ) => void;
  onSaveRepoScopes: (repoScopes: string[]) => void;
}

const FORM_CONTROL_STYLE = { width: "100%", maxWidth: "100%" } as const;

export function RepoScopeSection({
  t,
  org,
  currentMember,
  isAdmin,
  orgJoinRequests,
  pendingJoinRequests,
  memberNameById,
  submittingJoin,
  joinError,
  joinSubmitted,
  reviewingRequestId,
  reviewError,
  savingScopes,
  scopesError,
  scopesSaved,
  onRequestRepoJoin,
  onReviewRepoJoin,
  onSaveRepoScopes,
}: RepoScopeSectionProps) {
  const [joinRepoPath, setJoinRepoPath] = useState("");
  const [draftScopes, setDraftScopes] = useState<string[]>(
    org.repoScopes ?? []
  );
  const [newScopePath, setNewScopePath] = useState("");

  const scopesDirty = useMemo(() => {
    const current = org.repoScopes ?? [];
    if (current.length !== draftScopes.length) return true;
    return current.some((scope, index) => scope !== draftScopes[index]);
  }, [draftScopes, org.repoScopes]);

  const handleAddScope = () => {
    const trimmed = newScopePath.trim();
    if (!trimmed) return;
    if (draftScopes.includes(trimmed)) {
      setNewScopePath("");
      return;
    }
    setDraftScopes([...draftScopes, trimmed]);
    setNewScopePath("");
  };

  const handleRemoveScope = (path: string) => {
    setDraftScopes(draftScopes.filter((scope) => scope !== path));
  };

  const handleSave = () => {
    onSaveRepoScopes(draftScopes);
  };

  const handleSubmitJoin = () => {
    if (!joinRepoPath.trim()) return;
    onRequestRepoJoin(joinRepoPath.trim());
    setJoinRepoPath("");
  };

  return (
    <SectionContainer color="chatPanelInfo" padding="default">
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[13px] font-semibold text-text-1">
            {t("collaboration.orgRepoScopesTitle")}
          </div>
          <div className="mt-1 text-[12px] text-text-3">
            {t("collaboration.repoScopesHelp")}
          </div>
        </div>

        {isAdmin ? (
          <>
            <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
              {draftScopes.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-text-3">
                  {t("collaboration.orgRepoScopesEmpty")}
                </div>
              ) : (
                draftScopes.map((path) => (
                  <div
                    key={path}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-text-2"
                  >
                    <span className="min-w-0 truncate" title={path}>
                      {path}
                    </span>
                    <Button
                      htmlType="button"
                      size="small"
                      variant="secondary"
                      onClick={() => handleRemoveScope(path)}
                    >
                      {t("collaboration.removeRepoScope")}
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={newScopePath}
                onChange={setNewScopePath}
                placeholder="/path/to/repo"
                style={FORM_CONTROL_STYLE}
              />
              <Button
                htmlType="button"
                size="small"
                variant="secondary"
                onClick={handleAddScope}
                disabled={!newScopePath.trim()}
              >
                {t("collaboration.addRepoScope")}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                htmlType="button"
                size="small"
                variant="primary"
                onClick={handleSave}
                disabled={!scopesDirty || savingScopes}
                loading={savingScopes}
              >
                {t("collaboration.saveRepoScopes")}
              </Button>
              {scopesSaved ? (
                <span className="text-[12px] text-success-6">
                  {t("collaboration.repoScopesSaved")}
                </span>
              ) : null}
              {scopesError ? (
                <span className="text-[12px] text-danger-6">{scopesError}</span>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
            {(org.repoScopes ?? []).length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-text-3">
                {t("collaboration.orgRepoScopesEmpty")}
              </div>
            ) : (
              (org.repoScopes ?? []).map((path) => (
                <div
                  key={path}
                  className="px-3 py-2 text-[12px] text-text-2"
                  title={path}
                >
                  <span className="min-w-0 truncate">{path}</span>
                </div>
              ))
            )}
          </div>
        )}

        {!isAdmin && currentMember ? (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold text-text-1">
              {t("collaboration.requestRepoJoin")}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={joinRepoPath}
                onChange={setJoinRepoPath}
                placeholder="/path/to/your/repo"
                style={FORM_CONTROL_STYLE}
              />
              <Button
                htmlType="button"
                size="small"
                variant="secondary"
                onClick={handleSubmitJoin}
                disabled={!joinRepoPath.trim() || submittingJoin}
                loading={submittingJoin}
              >
                {t("collaboration.requestRepoJoin")}
              </Button>
            </div>
            {joinSubmitted ? (
              <span className="text-[12px] text-success-6">
                {t("collaboration.requestRepoJoinSent")}
              </span>
            ) : null}
            {joinError ? (
              <span className="text-[12px] text-danger-6">{joinError}</span>
            ) : null}
          </div>
        ) : null}

        {isAdmin && pendingJoinRequests.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold text-text-1">
              {t("collaboration.repoJoinRequestsTitle")}
            </div>
            <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
              {pendingJoinRequests.map((request) => (
                <div
                  key={request.requestId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-text-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate" title={request.repoPath}>
                      {t("collaboration.repoJoinPath")}: {request.repoPath}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {t("collaboration.repoJoinRequester", {
                        member:
                          memberNameById.get(request.requesterMemberId) ??
                          request.requesterMemberId,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      htmlType="button"
                      size="small"
                      variant="primary"
                      onClick={() => onReviewRepoJoin(request, true)}
                      disabled={reviewingRequestId === request.requestId}
                      loading={reviewingRequestId === request.requestId}
                    >
                      {t("collaboration.repoJoinApprove")}
                    </Button>
                    <Button
                      htmlType="button"
                      size="small"
                      variant="secondary"
                      onClick={() => onReviewRepoJoin(request, false)}
                      disabled={reviewingRequestId === request.requestId}
                    >
                      {t("collaboration.repoJoinReject")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {reviewError ? (
              <span className="text-[12px] text-danger-6">{reviewError}</span>
            ) : null}
          </div>
        ) : null}

        {isAdmin && orgJoinRequests.length > 0 ? (
          <div className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold text-text-1">
              {t("collaboration.repoJoinRequestsTitle")}
            </div>
            <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
              {orgJoinRequests.slice(0, 20).map((request) => (
                <div
                  key={request.requestId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-text-2"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate" title={request.repoPath}>
                      {request.repoPath}
                    </span>
                    <span className="text-[11px] text-text-3">
                      {t("collaboration.repoJoinRequester", {
                        member:
                          memberNameById.get(request.requesterMemberId) ??
                          request.requesterMemberId,
                      })}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-3">
                    {request.status === COLLAB_REPO_JOIN_STATUS.PENDING
                      ? t("collaboration.repoJoinStatusPending")
                      : request.status === COLLAB_REPO_JOIN_STATUS.APPROVED
                        ? t("collaboration.repoJoinStatusApproved")
                        : t("collaboration.repoJoinStatusRejected")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionContainer>
  );
}
