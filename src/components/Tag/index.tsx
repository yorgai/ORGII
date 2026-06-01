/**
 * Tag Component
 *
 * Labels for categorization, filtering, and status display.
 *
 * Features:
 * - Multiple colors/statuses
 * - Closable tags
 * - Icons support
 * - Checkable variant
 * - Multiple sizes
 * - Custom colors
 *
 * @example
 * ```tsx
 * import Tag from "@src/components/Tag";
 *
 * // Basic tag
 * <Tag>Default</Tag>
 *
 * // Colored tag
 * <Tag color="primary">Primary</Tag>
 *
 * // Closable tag
 * <Tag closable onClose={() => {}}>
 *   Closable
 * </Tag>
 *
 * // Tag with icon
 * <Tag icon={<i className="ri-star-line" />}>
 *   Featured
 * </Tag>
 * ```
 */
import { X } from "lucide-react";
import React, { useState } from "react";

import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./index.scss";

export interface TagProps {
  /**
   * Tag color/status
   * @default 'default'
   */
  color?:
    | "default"
    | "primary"
    | "success"
    | "warning"
    | "danger"
    | "processing"
    | string;

  /**
   * Tag size
   * @default 'default'
   */
  size?: "mini" | "small" | "default" | "large";

  /**
   * Enable close button
   * @default false
   */
  closable?: boolean;

  /**
   * Checkable variant (acts like checkbox)
   * @default false
   */
  checkable?: boolean;

  /**
   * Checked state (for checkable tags)
   */
  checked?: boolean;

  /**
   * Default checked state (uncontrolled)
   */
  defaultChecked?: boolean;

  /**
   * Tag icon
   */
  icon?: React.ReactNode;

  /**
   * Tag visible state (controlled)
   */
  visible?: boolean;

  /**
   * Bordered style
   * @default false
   */
  bordered?: boolean;

  /**
   * Pill shape (fully rounded sides)
   * @default false
   */
  pill?: boolean;

  /**
   * Close callback
   */
  onClose?: (e: React.MouseEvent) => void;

  /**
   * Check change callback (for checkable tags)
   */
  onCheck?: (checked: boolean) => void;

  /**
   * Click callback
   */
  onClick?: (e: React.MouseEvent) => void;

  /**
   * Additional class name
   */
  className?: string;

  /**
   * Additional style
   */
  style?: React.CSSProperties;

  /**
   * Children
   */
  children?: React.ReactNode;
}

const Tag: React.FC<TagProps> = ({
  color = "default",
  size = "default",
  closable = false,
  checkable = false,
  checked: controlledChecked,
  defaultChecked = false,
  icon,
  visible: controlledVisible,
  bordered = false,
  pill = false,
  onClose,
  onCheck,
  onClick,
  className = "",
  style,
  children,
}) => {
  const { isDark } = useCurrentTheme();
  const [internalVisible, setInternalVisible] = useState(true);
  const [internalChecked, setInternalChecked] = useState(defaultChecked);

  const visible =
    controlledVisible !== undefined ? controlledVisible : internalVisible;
  const checked =
    controlledChecked !== undefined ? controlledChecked : internalChecked;

  // Predefined colors
  const isPredefinedColor = [
    "default",
    "primary",
    "success",
    "warning",
    "danger",
    "processing",
  ].includes(color);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (controlledVisible === undefined) {
      setInternalVisible(false);
    }

    onClose?.(e);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (checkable) {
      const newChecked = !checked;
      if (controlledChecked === undefined) {
        setInternalChecked(newChecked);
      }
      onCheck?.(newChecked);
    }
    onClick?.(e);
  };

  if (!visible) {
    return null;
  }

  const tagClasses = [
    "tag",
    `tag-size-${size}`,
    isPredefinedColor && `tag-${color}`,
    bordered && "tag-bordered",
    pill && "tag-pill",
    checkable && "tag-checkable",
    checkable && checked && "tag-checked",
    closable && "tag-closable",
    isDark && "tag-dark",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const tagStyle: React.CSSProperties = {
    ...style,
    ...(!isPredefinedColor && {
      backgroundColor: `${color}20`,
      borderColor: "transparent",
      color: color,
    }),
  };

  return (
    <span className={tagClasses} style={tagStyle} onClick={handleClick}>
      {icon && <span className="tag-icon">{icon}</span>}
      <span className="tag-content">{children}</span>
      {closable && <X className="tag-close" size={14} onClick={handleClose} />}
    </span>
  );
};

export default Tag;
