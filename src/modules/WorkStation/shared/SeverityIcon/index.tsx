/**
 * SeverityIcon Component
 *
 * Renders appropriate icon for diagnostic/log severity levels.
 * Used in Problems panel, Debug console, and other diagnostic displays.
 */
import {
  AlertCircle,
  AlertTriangle,
  Info,
  type LucideIcon,
} from "lucide-react";
import React, { memo } from "react";

// ============================================
// Types
// ============================================

export type Severity = "error" | "warning" | "info" | "hint";

export interface SeverityIconProps {
  /** Severity level */
  severity: Severity;
  /** Icon size (default: 14) */
  size?: number;
  /** Additional class name */
  className?: string;
}

// ============================================
// Configuration
// ============================================

interface SeverityConfig {
  icon: LucideIcon;
  colorClass: string;
}

const SEVERITY_CONFIG: Record<Severity, SeverityConfig> = {
  error: {
    icon: AlertCircle,
    colorClass: "text-danger-6",
  },
  warning: {
    icon: AlertTriangle,
    colorClass: "text-warning-6",
  },
  info: {
    icon: Info,
    colorClass: "text-text-3",
  },
  hint: {
    icon: Info,
    colorClass: "text-text-3",
  },
};

// ============================================
// Component
// ============================================

export const SeverityIcon: React.FC<SeverityIconProps> = memo(
  ({ severity, size = 14, className = "" }) => {
    const config = SEVERITY_CONFIG[severity];
    const Icon = config.icon;

    return <Icon size={size} className={`${config.colorClass} ${className}`} />;
  }
);

SeverityIcon.displayName = "SeverityIcon";

/**
 * Utility function to get severity icon (for non-React contexts)
 */
export function getSeverityIcon(
  severity: Severity,
  size: number = 14
): React.ReactNode {
  return <SeverityIcon severity={severity} size={size} />;
}

export default SeverityIcon;
