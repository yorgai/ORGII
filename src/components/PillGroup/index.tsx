/**
 * PillGroup
 *
 * Shared pill row used by the session creator's model/source row,
 * repo/branch row, and the chat input model+source pill.
 *
 * Layout:
 *   [icon label]  |  [icon label]  |  [icon label]
 *
 * Resting state has no border/background — visible segments render as plain
 * icon+label runs separated by a thin `|` divider. When the cursor enters a
 * segment (or the segment becomes `active`, e.g. its dropdown is open), that
 * segment morphs into an independent rounded pill with a hover/active
 * background, the icon swaps to a chevron, and the dividers adjacent to it
 * disappear so the pill stands alone. Other segments stay transparent.
 *
 * A segment can opt into reveal-on-hover behaviour via `revealOnHover`: it
 * stays hidden until the cursor enters any segment in the group (or the
 * segment is `active` / `forceVisible`). The chat input bottom pill uses
 * this for the source segment so the row collapses to model-only at rest.
 *
 * Each segment is its own button with its own click/tooltip — they are
 * independent triggers, not two halves of the same control.
 */
import React, { memo, useCallback, useRef, useState } from "react";

import SelectorPill from "@src/components/SelectorPill";
import type { TooltipProps } from "@src/components/Tooltip";

const HOVER_LEAVE_DELAY_MS = 200;

export interface PillGroupSegment {
  /** Stable id used as React key and to derive aria attributes */
  id: string;
  /** Leading icon (rendered at rest and on hover) */
  icon: React.ReactNode;
  /** Visible label */
  label: string;
  /** Native title attribute (fallback when no `tooltip` is provided) */
  title?: string;
  /**
   * Styled tooltip content (mutually exclusive with `title`). Accepts either
   * a plain string or a React node — pass `<KeyboardShortcutTooltipContent />`
   * to attach a shortcut chip next to the label.
   */
  tooltip?: React.ReactNode;
  /**
   * When true, the tooltip renders in the framed-panel style used by the
   * chat-panel header buttons (light background, border, arrow) instead of
   * the default dark bubble.
   */
  tooltipFramed?: boolean;
  /** Tooltip placement relative to the segment. Defaults to `top`. */
  tooltipPosition?: TooltipProps["position"];
  /** ARIA label for the underlying button */
  ariaLabel?: string;
  /** Whether this segment's dropdown/selector is open. Forces pill styling. */
  active?: boolean;
  /** Render label in danger color to signal a missing required selection */
  danger?: boolean;
  /** Disable interaction — useful while a sibling is loading */
  disabled?: boolean;
  /** Click handler for the segment */
  onClick?: (event: React.MouseEvent) => void;
  /** Stable selector for rendered UI tests */
  dataTestId?: string;
  /** Open selector-style pills on press start for glass/driver hit-test parity */
  activateOnMouseDown?: boolean;
  /** Hard cap on the label width — applies overflow ellipsis */
  maxLabelWidth?: number;
  /** Forwarded ref for the underlying button — useful for dropdown positioning */
  buttonRef?: React.Ref<HTMLButtonElement>;
  /**
   * When true, the segment is hidden until the cursor enters the group, the
   * segment is `active`, or `forceVisible` is set. Used by chat-input model
   * pills to show only the model at rest and reveal the source on hover.
   */
  revealOnHover?: boolean;
  /**
   * Forces a `revealOnHover` segment to remain visible even when the group
   * is not hovered (e.g. no source selected yet — keep the placeholder
   * visible so users can click it).
   */
  forceVisible?: boolean;
}

export type PillGroupVariant = "default" | "ghost";

export interface PillGroupProps {
  segments: PillGroupSegment[];
  /** Optional class on the outer wrapper (e.g. flex-wrap, text size overrides) */
  className?: string;
  /** Optional class applied to every segment button. */
  segmentClassName?: string;
  /**
   * Visual variant for hover/active styling.
   *
   * - `default` — at rest segments are transparent + divider visible; on
   *   hover/active a segment gains a fill without adding a border ring.
   * - `ghost` — same resting behaviour, but on hover/active only the fill
   *   appears (no border ring). Used inside dense factory headers where a
   *   bordered pill would clash with the surrounding chrome.
   * - `solid` — resting state is transparent (same as `default`), but
   *   hover/active fills with `bg-chat-input` so the lit pill matches the
   *   composer input directly above. No border ring. Used by the full-width
   *   SessionCreator repo/branch/location row sitting under the composer.
   */
  variant?: PillGroupVariant;
}

const PillGroup: React.FC<PillGroupProps> = memo(
  ({ segments, className, segmentClassName, variant = "default" }) => {
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [groupHovered, setGroupHovered] = useState(false);
    const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleEnter = useCallback((index: number) => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      setHoveredIndex(index);
      setGroupHovered(true);
    }, []);

    const handleLeave = useCallback((index: number) => {
      setHoveredIndex((current) => (current === index ? null : current));
    }, []);

    const handleGroupLeave = useCallback(() => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => {
        setGroupHovered(false);
        setHoveredIndex(null);
      }, HOVER_LEAVE_DELAY_MS);
    }, []);

    const handleGroupEnter = useCallback(() => {
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      setGroupHovered(true);
    }, []);

    // Decide which segments are visible right now. A `revealOnHover` segment is
    // visible only while the group is hovered, the segment is `active`, or it
    // is `forceVisible`.
    const groupHasActive = segments.some((s) => s.active);
    const visibleMap = segments.map((segment) => {
      if (!segment.revealOnHover) return true;
      if (segment.forceVisible) return true;
      if (segment.active) return true;
      return groupHovered || groupHasActive;
    });

    return (
      <div
        className={`inline-flex items-center text-[12px] font-medium ${className ?? ""}`}
        onMouseEnter={handleGroupEnter}
        onMouseLeave={handleGroupLeave}
      >
        {segments.map((segment, index) => {
          const isVisible = visibleMap[index];
          if (!isVisible) return null;

          const isHovered = hoveredIndex === index;
          const isActive = !!segment.active;
          const isPillStyled = isHovered || isActive;

          // Find the nearest previous *visible* sibling for divider rendering.
          let previousVisibleIndex = -1;
          for (let i = index - 1; i >= 0; i--) {
            if (visibleMap[i]) {
              previousVisibleIndex = i;
              break;
            }
          }
          const previous =
            previousVisibleIndex >= 0
              ? segments[previousVisibleIndex]
              : undefined;
          const previousIsPilled =
            !!previous &&
            (hoveredIndex === previousVisibleIndex || !!previous.active);
          const showLeadingDivider =
            previousVisibleIndex >= 0 && !isPillStyled && !previousIsPilled;

          const handleMouseDown:
            | React.MouseEventHandler<HTMLButtonElement>
            | undefined =
            segment.activateOnMouseDown && segment.onClick
              ? (event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  segment.onClick?.(event);
                }
              : undefined;

          const button = (
            <SelectorPill
              ref={segment.buttonRef}
              icon={segment.icon}
              label={segment.label}
              title={segment.title}
              active={isActive}
              danger={segment.danger}
              disabled={segment.disabled}
              variant={variant}
              tooltip={segment.tooltip}
              tooltipFramed={segment.tooltipFramed}
              tooltipPosition={segment.tooltipPosition ?? undefined}
              ariaLabel={segment.ariaLabel}
              dataTestId={segment.dataTestId}
              className={segmentClassName ?? ""}
              labelStyle={
                segment.maxLabelWidth
                  ? { maxWidth: segment.maxLabelWidth }
                  : undefined
              }
              onClick={segment.onClick}
              onMouseDown={handleMouseDown}
              onMouseEnter={() => handleEnter(index)}
              onMouseLeave={() => handleLeave(index)}
              onFocus={() => handleEnter(index)}
              onBlur={() => handleLeave(index)}
              size="sm"
            />
          );

          return (
            <React.Fragment key={segment.id}>
              {previousVisibleIndex >= 0 && (
                <span
                  aria-hidden
                  className={`inline-flex h-3 w-px shrink-0 bg-border-2 transition-opacity duration-150 ${
                    showLeadingDivider ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
              {button}
            </React.Fragment>
          );
        })}
      </div>
    );
  }
);

PillGroup.displayName = "PillGroup";

export default PillGroup;
