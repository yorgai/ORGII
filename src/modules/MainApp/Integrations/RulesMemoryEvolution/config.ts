/**
 * Automation rule config — trigger type constants, icons, labels, and TRIGGER_ICON_MAP.
 *
 * Actions are now defined by the visual workflow editor's availableActions
 * catalog in data.ts — the old ACTION_CONFIG is removed.
 */
import {
  CalendarClock,
  Clock,
  GitBranch,
  MessageSquare,
  Timer,
  Zap,
} from "lucide-react";
import type { ElementType } from "react";

import { TRIGGER_TYPES, type TriggerType } from "./types";

export const TRIGGER_CONFIG: Record<
  TriggerType,
  { icon: string; label: string; description: string; phase: number }
> = {
  timer: {
    icon: "Timer",
    label: "Timer",
    description: "Fire at a fixed interval",
    phase: 1,
  },
  scheduledTime: {
    icon: "CalendarClock",
    label: "Scheduled Time",
    description: "Fire at a wall-clock time in a timezone",
    phase: 1,
  },
  cron: {
    icon: "Clock",
    label: "Cron",
    description: "Fire on a cron schedule",
    phase: 2,
  },
  gitActivity: {
    icon: "GitBranch",
    label: "Git Activity",
    description: "Fire on git events (commit, push, etc.)",
    phase: 2,
  },
  channelMessage: {
    icon: "MessageSquare",
    label: "Channel Message",
    description: "Fire when a message matches a pattern",
    phase: 2,
  },
  fileWatch: {
    icon: "Eye",
    label: "File Watch",
    description: "Fire when files change",
    phase: 2,
  },
  webhook: {
    icon: "Webhook",
    label: "Webhook",
    description: "Fire on inbound webhook",
    phase: 3,
  },
} as const;

/** Centralized trigger icon map — single source of truth. */
export const TRIGGER_ICON_MAP: Record<TriggerType, ElementType> = {
  timer: Timer,
  scheduledTime: CalendarClock,
  cron: Clock,
  gitActivity: GitBranch,
  channelMessage: MessageSquare,
  fileWatch: Zap,
  webhook: Zap,
};

/** Enabled trigger phases. Bump to [1, 2, 3] when Phase 3 is stable. */
export const ENABLED_TRIGGER_PHASES: number[] = [1, 2, 3];

/** Trigger types available based on enabled phases. */
export const AVAILABLE_TRIGGERS: TriggerType[] = TRIGGER_TYPES.filter((tt) =>
  ENABLED_TRIGGER_PHASES.includes(TRIGGER_CONFIG[tt].phase)
);
/** Default values for new rules. */
export const DEFAULT_TIMER_INTERVAL = 1800;
export const DEFAULT_DEBOUNCE_MS = 500;
