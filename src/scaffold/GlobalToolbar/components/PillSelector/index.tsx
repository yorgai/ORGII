/**
 * PillSelector Component
 *
 * Reusable pill-style selector with hover state for toolbar elements
 * Handles the complete pattern: base icon+text, hover with ChevronDown
 * Uses adaptive colors based on background luminance
 *
 * NOTE: Uses onPointerUp for click handling instead of onClick.
 * With Tauri's `titleBarStyle: "Overlay"` + `data-tauri-drag-region` on the
 * toolbar, macOS intercepts mousedown/click on non-interactive child elements.
 * Pointer events (pointerdown/pointerup) are unaffected by the drag region,
 * so we use onPointerUp as a reliable cross-platform click substitute.
 */
import { useAtomValue } from "jotai";
import { ChevronDown, type LucideIcon } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";

import { LIQUID_GLASS_PRESSED } from "@src/components/LiquidGlass/hoverConfig";
import { useRegionLuminance } from "@src/hooks/theme/useRegionLuminance";
import { useSafeHover } from "@src/hooks/ui/useSafeHover";
import { backgroundImageAtom } from "@src/store";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

const PILL_SELECTOR_HEIGHT = 28;

export interface PillSelectorProps {
  /** Lucide icon component for base state */
  icon: LucideIcon;
  /** Text label */
  label: string;
  /** Click handler */
  onClick: (e: React.MouseEvent) => void;
  /** Icon size (default: 14) */
  iconSize?: number;
  /** Icon stroke width (default: 1.75) */
  iconStrokeWidth?: number;
  /** Icon className for base state (default: "text-text-1") */
  iconClassName?: string;
  /** Text className (default: "text-[14px] font-medium text-text-1") */
  textClassName?: string;
  /** Show hover state with ChevronDown (default: true) */
  showHoverState?: boolean;
  /** Max width for the label text (enables truncation with ellipsis) */
  maxLabelWidth?: number | string;
  /** When true, hide the text label and show only the icon (compact mode) */
  hideLabel?: boolean;
  /** Called when hover state changes */
  onHoverChange?: (hovered: boolean) => void;
  /** When true, show the selector as open/selected */
  formOpen?: boolean;
  dataTestId?: string;
}

/**
 * PillSelector - Interactive pill with base and hover states
 *
 * Standard toolbar pill pattern:
 * - Base: Icon + Label
 * - Hover: ChevronDown + Label (with background)
 */
const PillSelector: React.FC<PillSelectorProps> = ({
  icon: Icon,
  label,
  onClick,
  iconSize = 14,
  iconStrokeWidth = 1.75,
  iconClassName,
  textClassName,
  showHoverState = true,
  maxLabelWidth,
  hideLabel = false,
  onHoverChange,
  formOpen = false,
  dataTestId,
}) => {
  const { isDark } = useCurrentTheme();
  const [ref, isHovered] = useSafeHover<HTMLDivElement>();
  const [isPressed, setIsPressed] = useState(false);
  useEffect(() => () => setIsPressed(false), []);

  const pointerDownRef = useRef(false);

  // Adaptive colors based on background luminance (theme-neutral)
  const backgroundConfig = useAtomValue(backgroundImageAtom);
  const { getRegion } = useRegionLuminance();
  const toolbarLuminance = getRegion("toolbar");
  const adaptiveEnabled = backgroundConfig.adaptiveColors ?? true;

  // Use adaptive text color when enabled, otherwise CSS variable
  const adaptiveTextColor = adaptiveEnabled
    ? toolbarLuminance.textColor
    : undefined;

  // Label styles with optional truncation
  const labelStyle: React.CSSProperties = maxLabelWidth
    ? {
        maxWidth:
          typeof maxLabelWidth === "number"
            ? `${maxLabelWidth}px`
            : maxLabelWidth,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }
    : {};

  const showOverlay = (isHovered || isPressed || formOpen) && showHoverState;

  return (
    <div
      ref={ref}
      data-testid={dataTestId}
      className="relative flex cursor-pointer items-center"
      style={{ height: PILL_SELECTOR_HEIGHT }}
      onPointerDown={() => {
        pointerDownRef.current = true;
        setIsPressed(true);
      }}
      onPointerUp={(e) => {
        if (pointerDownRef.current) {
          pointerDownRef.current = false;
          setIsPressed(false);
          onClick(e as unknown as React.MouseEvent);
        }
      }}
      onPointerCancel={() => {
        pointerDownRef.current = false;
        setIsPressed(false);
      }}
      onPointerLeave={() => {
        pointerDownRef.current = false;
        setIsPressed(false);
      }}
      onMouseEnter={() => {
        onHoverChange?.(true);
      }}
      onMouseLeave={() => {
        setIsPressed(false);
        pointerDownRef.current = false;
        onHoverChange?.(false);
      }}
      title={maxLabelWidth ? label : undefined}
    >
      {/* Base content - always rendered for sizing */}
      <div
        className={`flex items-center rounded-full py-1.5 ${hideLabel ? "px-2" : "gap-1.5 px-3"}`}
        style={{
          visibility: showOverlay ? "hidden" : "visible",
          height: PILL_SELECTOR_HEIGHT,
        }}
      >
        <Icon
          size={iconSize}
          strokeWidth={iconStrokeWidth}
          className={iconClassName || (!adaptiveEnabled ? "text-text-1" : "")}
          style={
            adaptiveTextColor && !iconClassName
              ? { color: adaptiveTextColor }
              : undefined
          }
        />
        {!hideLabel && label && (
          <span
            className={
              textClassName ||
              (!adaptiveEnabled
                ? "text-[14px] font-medium text-text-1"
                : "text-[14px] font-medium")
            }
            style={{
              ...labelStyle,
              ...(adaptiveTextColor && !textClassName
                ? { color: adaptiveTextColor }
                : {}),
            }}
          >
            {label}
          </span>
        )}
      </div>

      {/* Hover overlay with ChevronDown */}
      {showOverlay && !isPressed && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            gap: hideLabel ? "0px" : "6px",
            padding: hideLabel ? "0 8px" : "0 12px",
            borderRadius: "100px",
            height: PILL_SELECTOR_HEIGHT,
            background: "var(--color-fill-2)",
          }}
        >
          <ChevronDown
            size={iconSize}
            strokeWidth={iconStrokeWidth}
            className={
              !adaptiveEnabled ? "flex-shrink-0 text-text-1" : "flex-shrink-0"
            }
            style={adaptiveTextColor ? { color: adaptiveTextColor } : undefined}
          />
          {!hideLabel && label && (
            <span
              className={
                textClassName ||
                (!adaptiveEnabled
                  ? "text-[14px] font-medium text-text-1"
                  : "text-[14px] font-medium")
              }
              style={{
                ...labelStyle,
                ...(adaptiveTextColor && !textClassName
                  ? { color: adaptiveTextColor }
                  : {}),
              }}
            >
              {label}
            </span>
          )}
        </div>
      )}
      {/* Pressed overlay - distinct color for click feedback */}
      {showOverlay && isPressed && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            gap: hideLabel ? "0px" : "6px",
            padding: hideLabel ? "0 8px" : "0 12px",
            borderRadius: "100px",
            height: PILL_SELECTOR_HEIGHT,
            background: isDark
              ? LIQUID_GLASS_PRESSED.dark
              : LIQUID_GLASS_PRESSED.light,
          }}
        >
          <ChevronDown
            size={iconSize}
            strokeWidth={iconStrokeWidth}
            className={
              !adaptiveEnabled ? "flex-shrink-0 text-text-1" : "flex-shrink-0"
            }
            style={adaptiveTextColor ? { color: adaptiveTextColor } : undefined}
          />
          {!hideLabel && label && (
            <span
              className={
                textClassName ||
                (!adaptiveEnabled
                  ? "text-[14px] font-medium text-text-1"
                  : "text-[14px] font-medium")
              }
              style={{
                ...labelStyle,
                ...(adaptiveTextColor && !textClassName
                  ? { color: adaptiveTextColor }
                  : {}),
              }}
            >
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default PillSelector;
