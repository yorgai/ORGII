import type { TFunction } from "i18next";
import { GitFork, Loader2 } from "lucide-react";
import React, { useMemo } from "react";

import { SessionTable } from "@src/modules/shared/layouts/blocks";
import type { SessionTableItem } from "@src/modules/shared/layouts/blocks";
import type { CollabSessionSnapshotRequestRecord } from "@src/store/collaboration/types";

import { COLLAB_SNAPSHOT_REQUEST_STATUS } from "./constants";

interface SessionsSectionProps {
  t: TFunction<"navigation">;
  sessionItems: SessionTableItem[];
  latestSnapshotRequest: CollabSessionSnapshotRequestRecord | undefined;
  importingSessionId: string | null;
  /**
   * Replay-capable rows (design §16.11): only these get the ⑂ fork action —
   * metadata-only sessions have no history to inherit.
   */
  forkableSessionIds: ReadonlySet<string>;
  /** Row id currently being forked (loading state on its ⑂ button). */
  forkingSessionId: string | null;
  /** Onboarding banners (design §6.3): the two silent gates, reported apart. */
  showAccessOffBanner: boolean;
  showRepoScopesEmptyBanner: boolean;
  onOpenSettingsTab: () => void;
  onSelectSession: (item: SessionTableItem) => void;
  onForkSession: (item: SessionTableItem) => void;
}

export function SessionsSection({
  t,
  sessionItems,
  latestSnapshotRequest,
  importingSessionId,
  forkableSessionIds,
  forkingSessionId,
  showAccessOffBanner,
  showRepoScopesEmptyBanner,
  onOpenSettingsTab,
  onSelectSession,
  onForkSession,
}: SessionsSectionProps) {
  const showPendingMessage =
    latestSnapshotRequest?.status === COLLAB_SNAPSHOT_REQUEST_STATUS.PENDING ||
    latestSnapshotRequest?.status === COLLAB_SNAPSHOT_REQUEST_STATUS.SENT;

  // Row click stays "replay" (read-only import); the trailing ⑂ action is
  // "fork & continue" (design §16.11) — a NEW writable session inheriting the
  // teammate's history. Only replay-capable rows carry the action.
  const itemsWithForkAction = useMemo(
    () =>
      sessionItems.map((item) => {
        if (!forkableSessionIds.has(item.id)) return item;
        const isForking = forkingSessionId === item.id;
        return {
          ...item,
          rowAction: (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-1 px-2 py-0.5 text-[11px] font-medium text-primary-6 disabled:opacity-60"
              disabled={forkingSessionId !== null}
              title={t("collaboration.session.forkTooltip")}
              aria-label={t("collaboration.session.fork")}
              onClick={() => onForkSession(item)}
              data-testid={`collab-session-fork-${item.id}`}
            >
              {isForking ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <GitFork size={11} />
              )}
              {t("collaboration.session.fork")}
            </button>
          ),
        };
      }),
    [sessionItems, forkableSessionIds, forkingSessionId, onForkSession, t]
  );

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
        items={itemsWithForkAction}
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
