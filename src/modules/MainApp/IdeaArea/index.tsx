/**
 * Idea Area Page
 *
 * Explore trending app ideas, browse community-shared ideas, and manage your own.
 * Uses SplitViewLayout (left menu + right content).
 *
 * All views mount immediately (CSS hidden toggle) so switching is instant.
 */
import { useSetAtom } from "jotai";
import React, { Suspense, useCallback, useEffect, useState } from "react";

import SplitViewLayout from "@src/modules/shared/layouts/SplitViewLayout";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

import IdeaMenuPanel, { type IdeaAreaView } from "./components/IdeaMenuPanel";
import { ideaAreaActiveViewAtom } from "./store";

const TrendingView = React.lazy(() => import("./views/TrendingView"));
const SharedView = React.lazy(() => import("./views/SharedView"));
const MyIdeasView = React.lazy(() => import("./views/MyIdeasView"));

const SUSPENSE_FALLBACK = (
  <Placeholder variant="loading" placement="detail-panel" />
);

const IdeaAreaPage: React.FC = () => {
  const [activeView, setActiveView] = useState<IdeaAreaView>("trending");
  const setActiveViewAtom = useSetAtom(ideaAreaActiveViewAtom);

  useEffect(() => {
    setActiveViewAtom(activeView);
  }, [activeView, setActiveViewAtom]);

  const handleViewChange = useCallback((view: IdeaAreaView) => {
    setActiveView(view);
  }, []);

  const listContent = (
    <IdeaMenuPanel activeView={activeView} onViewChange={handleViewChange} />
  );

  const mainContent = (
    <>
      <div className={activeView === "trending" ? "h-full" : "hidden"}>
        <Suspense fallback={SUSPENSE_FALLBACK}>
          <TrendingView />
        </Suspense>
      </div>
      <div className={activeView === "shared" ? "h-full" : "hidden"}>
        <Suspense fallback={SUSPENSE_FALLBACK}>
          <SharedView />
        </Suspense>
      </div>
      <div className={activeView === "my-ideas" ? "h-full" : "hidden"}>
        <Suspense fallback={SUSPENSE_FALLBACK}>
          <MyIdeasView />
        </Suspense>
      </div>
    </>
  );

  return (
    <SplitViewLayout
      className="idea-area-page h-full"
      collapsible={true}
      resizable={true}
      listContent={listContent}
      mainContent={mainContent}
    />
  );
};

export default IdeaAreaPage;
