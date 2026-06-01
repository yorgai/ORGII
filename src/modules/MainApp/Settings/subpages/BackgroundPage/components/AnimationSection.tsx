/**
 * AnimationSection Component
 * Displays animation options and matrix character set settings
 */
import {
  SECTION_VALUE_SMALL_CLASSES,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { Check } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Switch from "@src/components/Switch";

import {
  ANIMATION_EMOJIS,
  MATRIX_CHAR_SET_OPTIONS,
  PRESET_ANIMATIONS,
} from "../config";
import type { BackgroundConfig, MatrixCharSet } from "../types";
import { filterByTheme } from "../utils";

interface AnimationSectionProps {
  config: BackgroundConfig;
  isDarkTheme: boolean;
  translationNamespace: string;
  onAnimationSelect: (animationId: string) => void;
  onAnimationClear: () => void;
  onMatrixCharSetChange: (charSet: MatrixCharSet) => void;
}

export const AnimationSection: React.FC<AnimationSectionProps> = ({
  config,
  isDarkTheme,
  translationNamespace,
  onAnimationSelect,
  onAnimationClear,
  onMatrixCharSetChange,
}) => {
  const { t } = useTranslation(translationNamespace);

  const filteredAnimations = filterByTheme(PRESET_ANIMATIONS, isDarkTheme);
  const isEnabled = !!config.animation;

  const handleEnabledChange = (next: boolean) => {
    if (next) {
      // Pick the first theme-appropriate preset as a sensible default.
      const first = filteredAnimations[0];
      if (first) onAnimationSelect(first.id);
    } else {
      onAnimationClear();
    }
  };

  return (
    <>
      <SectionRow label={t("background.enableAnimation")}>
        <Switch checked={isEnabled} onChange={handleEnabledChange} />
      </SectionRow>

      {isEnabled && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2">
          {filteredAnimations.map((anim) => {
            const isAnimSelected = config.animation === anim.id;

            return (
              <div
                key={anim.id}
                className={`group cursor-pointer overflow-hidden rounded-lg border transition-all ${
                  isAnimSelected
                    ? "border-primary-6 shadow-sm"
                    : "border-border-2 hover:border-primary-4 hover:shadow-sm"
                }`}
                onClick={() => onAnimationSelect(anim.id)}
                title={anim.description}
              >
                <div className="relative flex aspect-video w-full items-center justify-center bg-gradient-to-br from-bg-3 to-bg-2">
                  <span className="text-2xl">
                    {ANIMATION_EMOJIS[anim.id] || "✨"}
                  </span>
                  {isAnimSelected && (
                    <div className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary-6 text-white shadow-md">
                      <Check size={8} />
                    </div>
                  )}
                </div>
                <div className="bg-surface-container px-1.5 py-1">
                  <div
                    className={`truncate font-medium ${SECTION_VALUE_SMALL_CLASSES}`}
                  >
                    {t(`background.anim_${anim.label}`)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isEnabled && config.animation === "matrix" && (
        <SectionRow label={t("background.advancedOptions")} layout="vertical">
          <div className="grid grid-cols-4 gap-1.5">
            {MATRIX_CHAR_SET_OPTIONS.map((charSetOption) => {
              const isSelected =
                (config.matrixCharSet || "binary") === charSetOption.value;
              return (
                <button
                  key={charSetOption.value}
                  type="button"
                  onClick={() => onMatrixCharSetChange(charSetOption.value)}
                  className={`flex flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-center transition-all ${
                    isSelected
                      ? "border-primary-6 text-primary-6"
                      : "border-border-2 text-text-3 hover:border-primary-4 hover:bg-fill-1"
                  }`}
                >
                  <span className="text-[11px] font-medium">
                    {t(charSetOption.labelKey)}
                  </span>
                  <span className="text-[9px] opacity-70">
                    {charSetOption.example}
                  </span>
                </button>
              );
            })}
          </div>
        </SectionRow>
      )}
    </>
  );
};
