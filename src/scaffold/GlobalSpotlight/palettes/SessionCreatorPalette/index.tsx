/**
 * SessionCreatorPalette
 *
 * Embeds SessionCreatorChatPanel directly inside the Spotlight shell,
 * letting the user configure and launch a new session without leaving
 * the palette (no navigation to Agent Station).
 */
import { X } from "lucide-react";
import React, { useCallback } from "react";

import type { SessionLaunchSuccessInfo } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { SessionCreatorChatPanel } from "@src/features/SessionCreator/variants";
import type { BasePaletteProps } from "@src/scaffold/GlobalSpotlight/shared";

import { SpotlightShell } from "../../shell";

export interface SessionCreatorPaletteProps extends BasePaletteProps {
  asBody?: boolean;
}

export function SessionCreatorPalette({
  isOpen,
  onClose,
  onGoBackToParent,
  asBody: _asBody,
}: SessionCreatorPaletteProps) {
  const handleSessionStart = useCallback(
    (_info: SessionLaunchSuccessInfo) => {
      onClose();
    },
    [onClose]
  );

  const body = (
    <div className="flex min-h-0 flex-col">
      {/* Back pill */}
      <div className="flex items-center gap-2 border-b border-border-2/40 px-3 py-2">
        <button
          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-text-2 transition-colors hover:bg-fill-2 hover:text-text-1"
          onClick={onGoBackToParent ?? onClose}
        >
          <X size={11} />
          <span>New Session</span>
        </button>
      </div>

      <SessionCreatorChatPanel
        hidePresenceButton
        onSessionStart={handleSessionStart}
        innerClassName="!pb-4"
      />
    </div>
  );

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      hasActiveAction
      hideFooter
    >
      {body}
    </SpotlightShell>
  );
}
