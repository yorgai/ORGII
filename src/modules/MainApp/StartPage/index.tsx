/**
 * SuggestionsPage Component
 *
 * Main landing page with Launchpad grid
 */
import React from "react";

import { AppGrid, OpenSourceCountdown } from "./components";
import "./index.scss";

const SuggestionsPage: React.FC = () => {
  return (
    <div className="flex h-full flex-col">
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 scrollbar-hide">
        <OpenSourceCountdown />
        <AppGrid />
      </section>
    </div>
  );
};

export default SuggestionsPage;
