/**
 * Shared ORGII category badge (tier pill).
 *
 * Renders a coloured pill showing the model's ORGII pool category
 * (e.g. "Pro", "Pro Max"). Used in the code-account wizard,
 * model config panel, and model display components.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import {
  getBadgeClass,
  getCategoryLabelKey,
} from "@src/config/orgiiCategories";

const SIZE_CLASSES = {
  default: "px-2 py-0.5 text-[11px]",
  compact: "px-1.5 py-0 text-[10px] leading-[16px]",
} as const;

type CategoryBadgeSize = keyof typeof SIZE_CLASSES;

const CategoryBadge: React.FC<{
  categoryId: string;
  categoryIndex: number;
  size?: CategoryBadgeSize;
  className?: string;
}> = ({ categoryId, categoryIndex, size = "default", className = "" }) => {
  const { t } = useTranslation("market");
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${SIZE_CLASSES[size]} ${getBadgeClass(categoryIndex)} ${className}`}
    >
      {t(getCategoryLabelKey(categoryId))}
    </span>
  );
};

export default CategoryBadge;
