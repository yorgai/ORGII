/**
 * Health Options
 *
 * Health status configurations for projects.
 */
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import React from "react";

import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";
import type { ProjectHealth } from "@src/types/core/project";

import { HEALTH_COLORS } from "./colors";

// ============================================
// Health Options
// ============================================

export interface HealthOption {
  value: ProjectHealth;
  label: string;
  icon: React.ReactNode;
  color: string;
}

export const HEALTH_OPTIONS: HealthOption[] = [
  {
    value: "on_track",
    label: "On Track",
    icon: React.createElement(CheckCircle2, { size: DROPDOWN_ITEM.iconSize }),
    color: HEALTH_COLORS.on_track,
  },
  {
    value: "at_risk",
    label: "At Risk",
    icon: React.createElement(AlertTriangle, { size: DROPDOWN_ITEM.iconSize }),
    color: HEALTH_COLORS.at_risk,
  },
  {
    value: "off_track",
    label: "Off Track",
    icon: React.createElement(XCircle, { size: DROPDOWN_ITEM.iconSize }),
    color: HEALTH_COLORS.off_track,
  },
  {
    value: "no_updates",
    label: "No updates",
    icon: React.createElement(Clock, { size: DROPDOWN_ITEM.iconSize }),
    color: HEALTH_COLORS.no_updates,
  },
];

// ============================================
// Helper Functions
// ============================================

export function getHealthConfig(health: ProjectHealth) {
  return (
    HEALTH_OPTIONS.find((opt) => opt.value === health) || HEALTH_OPTIONS[3]
  );
}
