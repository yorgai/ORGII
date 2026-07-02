import type { TFunction } from "i18next";
import React from "react";

import { SessionTable } from "@src/modules/shared/layouts/blocks";
import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import type { CollabSessionSnapshotRequestRecord } from "@src/store/collaboration/types";

import { COLLAB_SNAPSHOT_REQUEST_STATUS } from "./constants";

interface SessionsSectionProps {
  t: TFunction<"navigation">;
  sessionItems: SessionTableItem[];
  latestSnapshotRequest: CollabSessionSnapshotRequestRecord | undefined;
  importingSessionId: string | null;
  /** Onboarding banners (design §6.3): the two silent gates, reported apart. */
  showAccessOffBanner: boolean;
  showRepoScopesEmptyBanner: boolean;
  onOpenSettingsTab: () => void;
  onSelectSession: (item: SessionTableItem) => void;
}

export function SessionsSection({
  t,
  sessionItems,
  latestSnapshotRequest,
  importingSessionId,
  showAccessOffBanner,
  showRepoScopesEmptyBanner,
  onOpenSettingsTab,
  onSelectSession,
}: SessionsSectionProps) {
  const showPendingMessage =
    latestSnapshotRequest?.status === COLLAB_SNAPSHOT_REQUEST_STATUS.PENDING ||
    latestSnapshotRequest?.status === COLLAB_SNAPSHOT_REQUEST_STATUS.SENT;

  return (
    <>
      {showAccessOffBanner ? (
        <div
          className="text-warning-7 flex items-center justify-between gap-3 rounded-lg bg-warning-1 px-3 py-2 text-[12px]"
          data-testid="collab-sessions-access-off-banner"
        >
          <span>{t("collaboration.onboarding.accessOffBanner")}</span>
          <button
            type="button"
            className="shrink-0 font-medium underline underline-offset-2"
            onClick={onOpenSettingsTab}
          >
            {t("collaboration.onboarding.accessOffBannerAction")}
          </button>
        </div>
      ) : null}
      {showRepoScopesEmptyBanner ? (
        <div
          className="text-warning-7 rounded-lg bg-warning-1 px-3 py-2 text-[12px]"
          data-testid="collab-sessions-repo-scopes-empty-banner"
        >
          {t("collaboration.orgRepoScopesEmpty")}
        </div>
      ) : null}
      <SessionTable
        items={sessionItems}
        onSelect={onSelectSession}
        showSearch
        surfaceVariant="chatPanel"
        maxHeight={520}
        pageSize={10}
        pageSizeOptions={[10, 25, 50]}
      />
      {importingSessionId ? (
        <div className="rounded-lg bg-fill-1 px-3 py-2 text-[12px] text-text-3">
          {t("collaboration.importingSession")}
        </div>
      ) : null}
      {showPendingMessage ? (
        <div className="rounded-lg bg-fill-1 px-3 py-2 text-[12px] text-text-3">
          {t("collaboration.access.requestPending")}
        </div>
      ) : null}
      {latestSnapshotRequest?.error ? (
        <div className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
          {latestSnapshotRequest.error}
        </div>
      ) : null}
    </>
  );
}
