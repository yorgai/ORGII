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
    <div className="relative flex h-full flex-col">
      <div
        className="absolute inset-x-0 top-0 z-10 h-[72px]"
        data-tauri-drag-region
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        aria-hidden
      />
      <section
        className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 scrollbar-hide"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <OpenSourceCountdown />
        <AppGrid />
      </section>
    </div>
  );
};

export default SuggestionsPage;
