/**
 * PropertyField Component
 *
 * Reusable property field component for displaying label-value pairs
 * Used in properties panels across WorkItem, Projects, and Profile
 */
import React from "react";

export interface PropertyFieldProps {
  /**
   * Icon to display (Lucide icon component)
   */
  icon: React.ReactNode;

  /**
   * Icon color
   */
  iconColor?: string;

  /**
   * Label text (optional)
   */
  label?: string;

  /**
   * Value content (can be string or component)
   */
  value: React.ReactNode;

  /**
   * Whether the field is clickable/interactive
   */
  onClick?: () => void;

  /**
   * Whether the field is currently active (for dropdowns)
   */
  isActive?: boolean;

  /**
   * Whether to show chevron for dropdown
   */
  showChevron?: boolean;

  /**
   * Suffix content (e.g., badges, counts)
   */
  suffix?: React.ReactNode;

  /**
   * Whether to support multiline text (wrap instead of truncate)
   */
  multiline?: boolean;

  /**
   * Additional className for the container
   */
  className?: string;
}

const PropertyField: React.FC<PropertyFieldProps> = ({
  icon,
  iconColor,
  label,
  value,
  onClick,
  isActive = false,
  showChevron = false,
  suffix,
  multiline = false,
  className = "",
}) => {
  const isInteractive = Boolean(onClick);

  const content = (
    <div
      className={`flex min-h-[36px] w-full items-start gap-1 px-2 py-1 ${className}`}
    >
      {label && (
        <span className="w-[72px] shrink-0 text-xs text-text-2">{label}</span>
      )}
      <div
        className={`flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-1.5 py-1.5 ${
          isInteractive
            ? "cursor-pointer transition-colors hover:bg-fill-2"
            : ""
        }`}
        style={
          isActive ? { backgroundColor: "var(--color-fill-2)" } : undefined
        }
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center text-text-3"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {icon}
        </span>
        <span
          className={`flex-1 text-xs text-text-1 ${multiline ? "whitespace-normal leading-relaxed" : "truncate"}`}
        >
          {value}
        </span>
        {suffix}
        {showChevron && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0 text-text-3"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );

  if (isInteractive) {
    return (
      <button
        className="w-full border-none bg-transparent p-0 text-left"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return content;
};

export default PropertyField;
