/**
 * SasPhraseDisplay
 *
 * Prominently renders the Short-Authentication-String confirmation
 * phrase the user must verify on the mobile side. Uses the system
 * default font at large size with high contrast — no monospace.
 */
import React from "react";

interface SasPhraseDisplayProps {
  phrase: string;
  label?: string;
}

const SasPhraseDisplay: React.FC<SasPhraseDisplayProps> = ({
  phrase,
  label,
}) => {
  return (
    <div className="flex flex-col items-center gap-2">
      {label && (
        <span className="text-xs uppercase tracking-wide text-text-3">
          {label}
        </span>
      )}
      <div className="rounded-lg border border-border-2 bg-fill-1 px-5 py-3">
        <span className="text-2xl font-semibold tracking-wide text-text-1">
          {phrase}
        </span>
      </div>
    </div>
  );
};

export default SasPhraseDisplay;
