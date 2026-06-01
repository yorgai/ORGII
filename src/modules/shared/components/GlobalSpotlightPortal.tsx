/**
 * Global Spotlight Portal Component
 *
 * Mounts the GlobalSpotlight when its open atom is true. The spotlight
 * itself owns its chrome (portal, glass, positioning, footer) via
 * SpotlightShell — this wrapper is now just an open-state binding +
 * a scoped MultiRepoGitStatusProvider for the spotlight's repo features.
 */
import { GlobalSpotlight } from "@/src/scaffold/GlobalSpotlight";
import { useAtom } from "jotai";
import React from "react";

import { MultiRepoGitStatusProvider } from "@src/contexts/git";
import { spotlightOpenAtom } from "@src/store";

export const GlobalSpotlightPortal: React.FC = () => {
  const [spotlightOpen, setSpotlightOpen] = useAtom(spotlightOpenAtom);

  if (!spotlightOpen) return null;

  return (
    <MultiRepoGitStatusProvider>
      <GlobalSpotlight isOpen={true} onClose={() => setSpotlightOpen(false)} />
    </MultiRepoGitStatusProvider>
  );
};
