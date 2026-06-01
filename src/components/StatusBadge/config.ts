/**
 * StatusBadge Configuration
 *
 * Status styling configuration for different states.
 */
import type { StatusStyle } from "./types";

/**
 * Get styling configuration for a given status
 */
export function getStatusStyle(status: string): StatusStyle {
  const normalizedStatus = status.toLowerCase();

  // Success states
  if (
    normalizedStatus === "success" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "verified" ||
    normalizedStatus.includes("completed")
  ) {
    return {
      bgColor: "bg-success-6/10",
      textColor: "text-success-6",
      dotColor: "bg-success-6",
      label: "SUCCESS",
    };
  }

  // Running states
  if (
    normalizedStatus === "running" ||
    normalizedStatus === "in_progress" ||
    normalizedStatus === "active" ||
    normalizedStatus === "confirmed" ||
    normalizedStatus.includes("pending")
  ) {
    return {
      bgColor: "bg-primary-6/10",
      textColor: "text-primary-6",
      dotColor: "bg-primary-6",
      label: "RUNNING",
    };
  }

  // Failed states
  if (
    normalizedStatus === "failed" ||
    normalizedStatus === "error" ||
    normalizedStatus.includes("error")
  ) {
    return {
      bgColor: "bg-danger-6/10",
      textColor: "text-danger-6",
      dotColor: "bg-danger-6",
      label: "FAILED",
    };
  }

  // Pending states
  if (normalizedStatus === "pending") {
    return {
      bgColor: "bg-warning-6/10",
      textColor: "text-warning-6",
      dotColor: "bg-warning-6",
      label: "PENDING",
    };
  }

  // Default/unknown state
  return {
    bgColor: "bg-fill-3",
    textColor: "text-text-3",
    dotColor: "bg-text-3",
    label: status.toUpperCase(),
  };
}

/**
 * Size configuration
 */
export const SIZE_CONFIG = {
  sm: {
    classes: "px-2 py-0.5 text-[10px] gap-1.5",
    dotSize: "h-1.5 w-1.5",
  },
  md: {
    classes: "px-3 py-1 text-[11px] gap-2",
    dotSize: "h-2 w-2",
  },
} as const;
