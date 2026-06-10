import { X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AdeSessionProposalDetail } from "@src/modules/WorkStation/ActionSystem/registration/actions/sessionActions.zod";
import { ADE_SESSION_PROPOSAL_RESPONSE_EVENT } from "@src/modules/WorkStation/ActionSystem/registration/actions/sessionActions.zod";

interface AgentControlProposalCardProps {
  proposal: AdeSessionProposalDetail;
  onDismiss: () => void;
}

const TOTAL_MS = 5 * 60 * 1000;

function useCountdown(expiresAt: number) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, expiresAt - Date.now())
  );
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemaining(left);
      if (left > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [expiresAt]);

  const seconds = Math.ceil(remaining / 1000);
  const pct = remaining / TOTAL_MS;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const label =
    mins > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${secs}s`;

  return { pct, label, expired: remaining === 0 };
}

export const AgentControlProposalCard: React.FC<
  AgentControlProposalCardProps
> = ({ proposal, onDismiss }) => {
  const { t } = useTranslation("common");
  const { pct, label, expired } = useCountdown(proposal.expiresAt);

  useEffect(() => {
    if (expired) onDismiss();
  }, [expired, onDismiss]);

  const handleCancel = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent(ADE_SESSION_PROPOSAL_RESPONSE_EVENT, {
        detail: {
          correlationId: proposal.correlationId,
          approved: false,
        },
      })
    );
    onDismiss();
  }, [onDismiss, proposal.correlationId]);

  const barColor =
    pct > 0.5 ? "bg-primary-6" : pct > 0.2 ? "bg-warning-5" : "bg-error-5";

  return (
    <div className="border-t border-border-2/50">
      {/* Countdown bar */}
      <div className="h-[2px] w-full bg-border-2/40">
        <div
          className={`h-full transition-none ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-text-1">
            {t("guiControl.proposalTitle")}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-3">
            {proposal.task}
          </p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-2">
          <span
            className={`font-mono text-[11px] tabular-nums ${
              pct <= 0.2 ? "text-error-5" : "text-text-3"
            }`}
          >
            {label}
          </span>
          <button
            type="button"
            className="flex items-center text-text-3 transition-colors hover:text-text-1"
            onClick={handleCancel}
            aria-label={t("actions.dismiss")}
          >
            <X size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
};
