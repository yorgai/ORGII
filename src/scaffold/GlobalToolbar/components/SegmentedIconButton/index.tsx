import type { LucideIcon } from "lucide-react";
import React, { forwardRef } from "react";

interface SegmentedIconButtonProps {
  icon: LucideIcon;
  selected: boolean;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  ariaPressed?: boolean;
  testId?: string;
  sizeClassName?: string;
  selectedClassName?: string;
  unselectedClassName?: string;
  className?: string;
  style?: React.CSSProperties;
  iconSize?: number;
  strokeWidth?: number;
  iconColor?: string;
  overlay?: React.ReactNode;
  transitionClassName?: string;
  onMouseLeave?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseDown?: React.MouseEventHandler<HTMLButtonElement>;
  onMouseUp?: React.MouseEventHandler<HTMLButtonElement>;
}

export const SegmentedIconButton = forwardRef<
  HTMLButtonElement,
  SegmentedIconButtonProps
>(
  (
    {
      icon: Icon,
      selected,
      onClick,
      title,
      ariaLabel,
      ariaPressed,
      testId,
      sizeClassName = "h-[28px] w-[28px]",
      selectedClassName = "bg-primary-6 text-text-white",
      unselectedClassName = "bg-transparent text-text-1",
      className = "",
      style,
      iconSize = 16,
      strokeWidth = 1.75,
      iconColor = "currentColor",
      overlay,
      transitionClassName = "transition-all duration-200",
      onMouseLeave,
      onMouseDown,
      onMouseUp,
    },
    ref
  ) => (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      data-testid={testId}
      onMouseLeave={onMouseLeave}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      className={`relative flex ${sizeClassName} cursor-pointer items-center justify-center overflow-hidden rounded-[100px] border-none p-0 ${transitionClassName} ${
        selected ? selectedClassName : unselectedClassName
      } ${className}`}
      style={style}
    >
      {overlay}
      <div className="relative z-[1]">
        <Icon size={iconSize} strokeWidth={strokeWidth} color={iconColor} />
      </div>
    </button>
  )
);

SegmentedIconButton.displayName = "SegmentedIconButton";

export default SegmentedIconButton;
