import type { ProjectHealth, ProjectPriority, ProjectStatus } from "./types";

interface OptionConfig<T extends string> {
  value: T;
  labelKey: string;
  color: string;
}

export const STATUS_OPTIONS: OptionConfig<ProjectStatus>[] = [
  {
    value: "backlog",
    labelKey: "properties.statusOptions.backlog",
    color: "#6B7280",
  },
  {
    value: "planned",
    labelKey: "properties.statusOptions.planned",
    color: "#8B8B8B",
  },
  {
    value: "in_progress",
    labelKey: "properties.statusOptions.inProgress",
    color: "#4096FF",
  },
  {
    value: "completed",
    labelKey: "properties.statusOptions.completed",
    color: "#52C41A",
  },
  {
    value: "canceled",
    labelKey: "properties.statusOptions.canceled",
    color: "#FF4D4F",
  },
];

export const PRIORITY_OPTIONS: OptionConfig<ProjectPriority>[] = [
  {
    value: "urgent",
    labelKey: "properties.priorityOptions.urgent",
    color: "#FF4D4F",
  },
  {
    value: "high",
    labelKey: "properties.priorityOptions.high",
    color: "#FF7A45",
  },
  {
    value: "medium",
    labelKey: "properties.priorityOptions.medium",
    color: "#FAAD14",
  },
  {
    value: "low",
    labelKey: "properties.priorityOptions.low",
    color: "#52C41A",
  },
  {
    value: "none",
    labelKey: "properties.priorityOptions.none",
    color: "#8B8B8B",
  },
];

export const HEALTH_OPTIONS: OptionConfig<ProjectHealth>[] = [
  {
    value: "on_track",
    labelKey: "properties.healthOptions.onTrack",
    color: "#52C41A",
  },
  {
    value: "at_risk",
    labelKey: "properties.healthOptions.atRisk",
    color: "#FAAD14",
  },
  {
    value: "off_track",
    labelKey: "properties.healthOptions.offTrack",
    color: "#FF4D4F",
  },
  {
    value: "no_updates",
    labelKey: "properties.noUpdates",
    color: "#8B8B8B",
  },
];
