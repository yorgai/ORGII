/**
 * StatusBadge Types
 */

export type StatusType =
  | "success"
  | "completed"
  | "verified"
  | "running"
  | "in_progress"
  | "active"
  | "confirmed"
  | "pending"
  | "failed"
  | "error"
  | string;

export interface StatusBadgeProps {
  /** Status string to display */
  status: StatusType;
  /** Size variant */
  size?: "sm" | "md";
  /** Show animated pulse indicator */
  showPulse?: boolean;
  /** Custom label (overrides auto-generated label) */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

export interface StatusStyle {
  bgColor: string;
  textColor: string;
  dotColor: string;
  label: string;
}
