/**
 * EventNavigateIcon
 *
 * Token-button styled icon for navigating to an event in the simulator.
 *
 * Variants:
 * - "header" (default): hidden until `group/chat-block-header` is hovered.
 *   Uses `fill-3` hover because it sits inside a `fill-2` container.
 * - "footer": always visible, same token-button styling.
 */
import { ArrowUpRight } from "lucide-react";
import React, { memo } from "react";

const BASE_CLASSES =
  "flex h-5 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-text-3 transition-colors hover:bg-fill-2 hover:text-text-1";

const HEADER_VISIBILITY =
  "w-0 overflow-hidden opacity-0 transition-[width,opacity,background-color,color] group-hover/chat-block-header:w-5 group-hover/chat-block-header:opacity-100";
const FOOTER_VISIBILITY = "w-5";

export interface EventNavigateIconProps {
  onClick: () => void;
  /** "header" hides until parent hover; "footer" is always visible. */
  variant?: "header" | "footer";
}

const EventNavigateIcon: React.FC<EventNavigateIconProps> = memo(
  ({ onClick, variant = "header" }) => {
    const handleClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick();
    };

    return (
      <button
        type="button"
        data-testid="event-navigate"
        className={`${BASE_CLASSES} ${variant === "header" ? HEADER_VISIBILITY : FOOTER_VISIBILITY}`}
        onClick={handleClick}
        tabIndex={-1}
      >
        <ArrowUpRight size={14} />
      </button>
    );
  }
);

EventNavigateIcon.displayName = "EventNavigateIcon";

export default EventNavigateIcon;
