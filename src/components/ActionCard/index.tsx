/**
 * ActionCard Component
 *
 * Canonical selectable card used across Code Accounts, Wizards, and Model selection.
 * Supports multiple variants, icons (Lucide or custom elements), and selection state.
 *
 * For selection card tokens (use in custom layouts), import from config:
 *   import { SELECTION_CARD_CLASSES, getSelectionCardClass } from "@src/components/ActionCard/config";
 *
 * @example
 * ```tsx
 * import ActionCard from "@src/components/ActionCard";
 * import { Search, Zap } from "lucide-react";
 *
 * // With Lucide icon (clickable card)
 * <ActionCard
 *   title="Auto-detect"
 *   description="Find API key from local config files"
 *   onClick={handleDetect}
 *   variant="primary"
 *   icon={Search}
 * />
 *
 * // With tooltip (info icon inside card)
 * <ActionCard
 *   title="Timer"
 *   tooltip="Fire at a fixed interval"
 *   onClick={() => onSelect("timer")}
 *   icon={Timer}
 *   showSelect
 *   selected={selected === "timer"}
 * />
 * ```
 */
import { ArrowRight, Check, Info } from "lucide-react";
import React from "react";

import Button from "@src/components/Button";
import Tooltip from "@src/components/Tooltip";

import { VARIANT_STYLES } from "./config";
import type { ActionCardProps } from "./types";

const ActionCard: React.FC<ActionCardProps> = ({
  title,
  description,
  onClick,
  variant = "default",
  icon: Icon,
  iconElement,
  iconPreserveColor = false,
  buttonText,
  buttonLoading = false,
  disabled = false,
  showSelect = false,
  showSelectionCheck = true,
  showCheckbox = false,
  showRadio = false,
  selected = false,
  showArrow = false,
  tooltip,
  badge,
  dataTestId,
  className = "",
}) => {
  const variantConfig = VARIANT_STYLES[variant];

  const handleClick = () => {
    if (!disabled && !buttonText) {
      // Only trigger onClick on card click if there's no button
      onClick();
    }
  };

  const handleButtonClick = () => {
    if (!disabled) {
      onClick();
    }
  };

  // Determine container classes - use selected styling when showSelect/showCheckbox is true and selected
  const hasSelector = showSelect || showCheckbox || showRadio;
  const isSelectedState = hasSelector && selected;
  const containerClasses = [
    isSelectedState
      ? variantConfig.selectedContainerClass
      : variantConfig.containerClass,
    !buttonText ? variantConfig.containerHoverClass : "",
    disabled ? "opacity-50 cursor-not-allowed" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Resolve icon: iconElement takes precedence over icon
  const iconColorClass =
    iconPreserveColor || !isSelectedState
      ? variantConfig.iconClass
      : variantConfig.selectedIconClass;

  return (
    <div
      className={`${showArrow ? "group" : ""}${containerClasses}`}
      onClick={handleClick}
      data-testid={dataTestId}
    >
      <div className="flex items-center gap-2">
        {showCheckbox && !showRadio && (
          <span
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded ${
              selected
                ? "border-primary-6 bg-primary-6"
                : "border border-text-4 bg-transparent"
            }`}
          >
            {selected && <Check size={10} className="text-white" />}
          </span>
        )}
        {showRadio && (
          <span
            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
              selected ? "border-primary-6" : "border-text-4"
            }`}
          >
            {selected && <span className="h-2 w-2 rounded-full bg-primary-6" />}
          </span>
        )}
        {iconElement ? (
          <div className={`flex-shrink-0 ${iconColorClass}`}>{iconElement}</div>
        ) : Icon ? (
          <Icon size={16} className={iconColorClass} />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={
                isSelectedState
                  ? variantConfig.selectedTitleClass
                  : variantConfig.titleClass
              }
            >
              {title}
            </p>
            {badge && (
              <span className="inline-flex flex-shrink-0 items-center rounded-full bg-primary-1 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-6">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className={variantConfig.descriptionClass}>{description}</p>
          )}
        </div>
        {tooltip && !(hasSelector && selected) && (
          <Tooltip content={tooltip} showArrow={false} position="top">
            <span
              className="flex-shrink-0 cursor-help text-text-3 hover:text-text-2"
              onClick={(event) => event.stopPropagation()}
            >
              <Info size={14} />
            </span>
          </Tooltip>
        )}
        {buttonText && (
          <Button
            variant={variant === "primary" ? "primary" : "secondary"}
            size="small"
            onClick={handleButtonClick}
            disabled={disabled}
            loading={buttonLoading}
          >
            {buttonText}
          </Button>
        )}
        {showSelect &&
          showSelectionCheck &&
          !showCheckbox &&
          !showRadio &&
          selected &&
          (tooltip ? (
            <Tooltip content={tooltip} showArrow={false} position="top">
              <span className="flex-shrink-0 cursor-help">
                <Check size={14} className="text-primary-6" />
              </span>
            </Tooltip>
          ) : (
            <Check size={14} className="flex-shrink-0 text-primary-6" />
          ))}
        {showArrow && (
          <ArrowRight
            size={14}
            className="invisible flex-shrink-0 text-text-1 group-hover:visible group-active:visible"
          />
        )}
      </div>
    </div>
  );
};

export default ActionCard;
export { SELECTION_CARD_CLASSES, getSelectionCardClass } from "./config";
export type { ActionCardProps, ActionCardVariant } from "./types";
