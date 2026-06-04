/**
 * BasePill
 *
 * Shared pill shell used by both:
 * - ComposerPill (variant="editor"): flat inline ref inside a contenteditable host,
 *   primary-6 text color, no background, shows an X delete button on hover.
 * - InlinePill in UserMessageContent (variant="display"): badge-style pill with
 *   primary-2 background, padding, border-radius — read-only, no delete button.
 *
 * Icon resolution and click behaviour remain in the calling component;
 * BasePill only renders the structural shell.
 */
import React from "react";

import {
  EDITOR_FILE_PILL_BASE_STYLE,
  EDITOR_FILE_PILL_ICON_STYLE,
  PILL_BASE_STYLE,
  PILL_ICON_STYLE,
} from "@src/config/pillTokens";

export interface BasePillProps {
  variant: "editor" | "display";
  iconNode: React.ReactNode;
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLSpanElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLSpanElement>;
  onMouseDown?: React.MouseEventHandler<HTMLSpanElement>;
  /** Only meaningful in editor variant — forwards contentEditable={false} */
  contentEditable?: false;
  suppressContentEditableWarning?: boolean;
  className?: string;
  style?: React.CSSProperties;
  role?: string;
  tabIndex?: number;
  /** Forwarded ref for position calculations (e.g. preview portal in ComposerPill) */
  pillRef?: React.RefObject<HTMLSpanElement>;
  /** Arbitrary data-* attributes */
  [key: `data-${string}`]: unknown;
}

const BasePill = React.forwardRef<HTMLSpanElement, BasePillProps>(
  (
    {
      variant,
      iconNode,
      children,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onMouseDown,
      contentEditable: _contentEditable,
      suppressContentEditableWarning: _suppressContentEditableWarning,
      className,
      style,
      role,
      tabIndex,
      pillRef,
      ...dataProps
    },
    ref
  ) => {
    const isEditor = variant === "editor";

    const baseStyle = isEditor ? EDITOR_FILE_PILL_BASE_STYLE : PILL_BASE_STYLE;
    const iconStyle = isEditor ? EDITOR_FILE_PILL_ICON_STYLE : PILL_ICON_STYLE;

    const resolvedRef =
      pillRef ?? (ref as React.RefObject<HTMLSpanElement> | null) ?? undefined;

    return (
      <span
        ref={resolvedRef}
        className={className}
        style={{ ...baseStyle, ...style }}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        role={role}
        tabIndex={tabIndex}
        {...(isEditor
          ? {
              contentEditable: false,
              suppressContentEditableWarning: true,
            }
          : {})}
        {...(dataProps as React.HTMLAttributes<HTMLSpanElement>)}
      >
        <span style={iconStyle}>{iconNode}</span>
        {children}
      </span>
    );
  }
);
BasePill.displayName = "BasePill";

export default BasePill;
