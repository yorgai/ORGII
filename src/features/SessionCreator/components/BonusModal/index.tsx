/**
 * BonusModal Component
 *
 * Modal shown when user gets a "Surprise Bonus" - a better tier than requested.
 * Displays the tier they got, the % off official price, and a Continue button.
 */
import { Crown, Sparkles, X } from "lucide-react";
import React, { useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Glass from "@src/components/Glass";

// Tier styling config
const TIER_STYLES: Record<
  string,
  { color: string; label: string; bg: string }
> = {
  vip: { color: "#FFB800", label: "VIP", bg: "rgba(255, 184, 0, 0.15)" },
  premium: {
    color: "#9747FF",
    label: "Premium",
    bg: "rgba(151, 71, 255, 0.15)",
  },
  standard: {
    color: "#00B578",
    label: "Standard",
    bg: "rgba(0, 181, 120, 0.15)",
  },
  basic: { color: "#165DFF", label: "Basic", bg: "rgba(22, 93, 255, 0.15)" },
};

export interface BonusInfo {
  hasBonus: boolean;
  bonusMessage: string | null;
  originalTier: string | null;
  actualTier: string | null;
  bonusExhausted: boolean;
  /** Optional pricing fields (shown when available) */
  inputPrice?: string;
  outputPrice?: string;
  discount?: string;
}

interface BonusModalProps {
  bonusInfo: BonusInfo;
  /** Model name to display */
  modelName?: string;
  /** Called when user accepts the bonus */
  onAccept: () => void;
  /** Called when user declines */
  onDecline: () => void;
}

const BonusModal: React.FC<BonusModalProps> = ({
  bonusInfo,
  modelName,
  onAccept,
  onDecline,
}) => {
  const { t } = useTranslation("sessions");
  const tierStyle =
    TIER_STYLES[bonusInfo.actualTier ?? "standard"] || TIER_STYLES.standard;

  const hasPricing = bonusInfo.inputPrice || bonusInfo.outputPrice;
  const inputPrice = parseFloat(bonusInfo.inputPrice || "0");
  const outputPrice = parseFloat(bonusInfo.outputPrice || "0");

  const handleContinue = useCallback(() => {
    onAccept();
  }, [onAccept]);

  const content = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
      onClick={onDecline}
    >
      <Glass
        material="thick"
        radius={20}
        className="relative mx-4 w-full max-w-[380px] overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <Button
          onClick={onDecline}
          className="absolute right-4 top-4 z-10 p-1 text-text-3 transition-colors hover:text-text-1"
          icon={<X size={20} />}
        />

        {/* Hero section with tier badge */}
        <div
          className="flex flex-col items-center px-6 py-8"
          style={{ backgroundColor: tierStyle.bg }}
        >
          {/* Sparkle icon */}
          <div
            className="mb-3 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: tierStyle.color }}
          >
            <Sparkles size={28} className="text-white" />
          </div>

          {/* Tier badge */}
          <div className="mb-2 flex items-center gap-2">
            <span
              className="text-[32px] font-bold"
              style={{ color: tierStyle.color }}
            >
              {tierStyle.label}
            </span>
            {bonusInfo.actualTier === "vip" && (
              <Crown size={24} style={{ color: tierStyle.color }} />
            )}
          </div>

          {/* Discount badge - uses discount from backend */}
          {bonusInfo.discount && (
            <div
              className="mb-2 rounded-full px-4 py-1 text-[13px] font-semibold"
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.3)",
                color: tierStyle.color,
              }}
            >
              {bonusInfo.discount}
            </div>
          )}

          {/* Bonus message */}
          <p className="text-center text-[14px] text-text-2">
            🎉 {t("creator.bonusMessage")}
          </p>
        </div>

        {/* Details */}
        <div className="px-6 py-5">
          {modelName && (
            <p className="mb-4 text-center text-[13px] text-text-3">
              Model:{" "}
              <span className="font-medium text-text-1">{modelName}</span>
            </p>
          )}

          {/* Upgrade celebration message — always positive */}
          <p className="mb-5 text-center text-[13px] text-text-2">
            {t("creator.upgradedToTier", { tier: tierStyle.label })}
          </p>

          {/* Price breakdown (only shown when pricing data is available) */}
          {hasPricing && (
            <div className="mb-5 rounded-[12px] border border-solid border-border-2 bg-fill-1 p-4">
              <div className="mb-3 text-center text-[11px] font-semibold uppercase tracking-wide text-text-3">
                {t("creator.yourPrice")}
              </div>
              <div className="flex justify-center gap-6">
                <div className="text-center">
                  <div className="text-[10px] text-text-3">
                    {t("creator.inputPerM")}
                  </div>
                  <div
                    className="text-[20px] font-bold tabular-nums"
                    style={{ color: tierStyle.color }}
                  >
                    ${inputPrice.toFixed(2)}
                  </div>
                </div>
                <div className="h-10 w-px bg-border-2" />
                <div className="text-center">
                  <div className="text-[10px] text-text-3">
                    {t("creator.outputPerM")}
                  </div>
                  <div
                    className="text-[20px] font-bold tabular-nums"
                    style={{ color: tierStyle.color }}
                  >
                    ${outputPrice.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Continue button */}
          <Button
            variant="primary"
            size="large"
            long
            onClick={handleContinue}
            style={{
              backgroundColor: tierStyle.color,
              borderColor: tierStyle.color,
            }}
          >
            {t("creator.continueWithTier", { tier: tierStyle.label })}
          </Button>

          {/* Cancel link */}
          <button
            onClick={onDecline}
            className="mt-3 w-full text-center text-[13px] text-text-3 transition-colors hover:text-text-1"
          >
            {t("common:actions.cancel")}
          </button>
        </div>
      </Glass>
    </div>
  );

  return createPortal(content, document.body);
};

export default BonusModal;
