/**
 * Dev Record Page
 *
 * Developer activity analytics: Git Dashboard, Coding Profile, Projects, Sessions, Other Usage.
 * Navigation lives in the home sidebar (DevRecordSidebar); this page is full-width content.
 *
 * All views mount immediately (CSS hidden toggle) so JS bundles download
 * in parallel and data fetches start concurrently. Switching tabs is instant.
 */
import { useAtomValue } from "jotai";
import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";
import { currentRepoAtom } from "@src/store/repo/derived";
import { devRecordActiveViewAtom } from "@src/store/ui/devRecordToolbarAtom";

const GitDashboardView = React.lazy(() => import("./views/GitDashboardView"));
const SessionsView = React.lazy(() => import("./views/SessionsView"));
const OtherUsageView = React.lazy(() => import("./views/OtherUsageView"));

const SUSPENSE_FALLBACK = (
  <Placeholder variant="loading" placement="detail-panel" />
);

const DevRecordPage: React.FC = () => {
  const { t } = useTranslation();
  const activeView = useAtomValue(devRecordActiveViewAtom);
  const currentRepo = useAtomValue(currentRepoAtom);

  const repoId = currentRepo?.id ?? currentRepo?.path;

  return (
    <div className="dev-record-page h-full">
      <div className={activeView === "git-dashboard" ? "h-full" : "hidden"}>
        {currentRepo?.path && repoId ? (
          <Suspense fallback={SUSPENSE_FALLBACK}>
            <GitDashboardView repoPath={currentRepo.path} repoId={repoId} />
          </Suspense>
        ) : (
          <Placeholder
            variant="empty"
            placement="detail-panel"
            title={t("devRecord.noRepo")}
            subtitle={t("devRecord.noRepoSubtitle")}
          />
        )}
      </div>
      <div className={activeView === "sessions" ? "h-full" : "hidden"}>
        <Suspense fallback={SUSPENSE_FALLBACK}>
          <SessionsView />
        </Suspense>
      </div>
      <div className={activeView === "other-usage" ? "h-full" : "hidden"}>
        <Suspense fallback={SUSPENSE_FALLBACK}>
          <OtherUsageView />
        </Suspense>
      </div>
    </div>
  );
};

export default DevRecordPage;
