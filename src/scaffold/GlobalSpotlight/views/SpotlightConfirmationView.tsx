/**
 * SpotlightConfirmationView Component
 *
 * Renders the confirmation page for actions without modals
 * Separated from main component for better maintainability
 */
import React from "react";
import { useTranslation } from "react-i18next";

import type { UseConfirmationPageReturn } from "../hooks/core/types";

// ============================================
// Types
// ============================================

type ConfirmationParameter = {
  label: string;
  value: string;
  icon?: string | React.ComponentType<Record<string, unknown>>;
};

export interface SpotlightConfirmationViewProps {
  confirmationPage: UseConfirmationPageReturn;
}

// ============================================
// Component
// ============================================

export const SpotlightConfirmationView: React.FC<
  SpotlightConfirmationViewProps
> = ({ confirmationPage }) => {
  const { t } = useTranslation();

  if (
    !confirmationPage.showConfirmation ||
    !confirmationPage.confirmationData
  ) {
    return null;
  }

  const { actionLabel, actionIcon, parameters } =
    confirmationPage.confirmationData;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Action Header */}
      <div className="flex items-center gap-3">
        {typeof actionIcon === "string" ? (
          <i className={`${actionIcon} text-[24px] text-primary-6`} />
        ) : (
          React.createElement(
            actionIcon as unknown as React.ComponentType<{
              size: number;
              className: string;
            }>,
            {
              size: 24,
              className: "text-primary-6",
            }
          )
        )}
        <h2 className="text-[20px] font-semibold text-text-1">{actionLabel}</h2>
      </div>

      {/* Parameters */}
      <div className="flex flex-col gap-2 rounded-lg bg-fill-1 p-4">
        {parameters.map((param: ConfirmationParameter, idx: number) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[14px] text-text-2">{param.label}:</span>
            <span className="text-[14px] font-medium text-text-1">
              {param.value}
            </span>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={confirmationPage.back}
          className="flex items-center gap-2 rounded-lg border border-border-2 px-4 py-2 text-[14px] text-text-1 hover:bg-fill-1"
        >
          ← {t("actions.back")}
        </button>
        <button
          onClick={confirmationPage.confirm}
          className="flex items-center gap-2 rounded-lg bg-primary-6 px-4 py-2 text-[14px] text-text-white transition-colors hover:bg-primary-5"
        >
          {actionLabel} →
        </button>
      </div>
    </div>
  );
};

export default SpotlightConfirmationView;
