/**
 * Stat card config — standardized icons and label keys for Dev Record stat cards.
 *
 * Use these across Git Dashboard, Coding Profile, Projects, and AI Impact tabs
 * for consistent visuals and terminology.
 */
import {
  Clock,
  Coins,
  Cpu,
  Diff,
  FileDiff,
  Flame,
  FolderKanban,
  GitCommit,
  History,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type StatCardKey =
  | "commits"
  | "contributors"
  | "filesChanged"
  | "linesChanged"
  | "sessions"
  | "filesTouched"
  | "streak"
  | "tokensUsed"
  | "modelsUsed"
  | "projects"
  | "codingTime";

export interface StatCardConfig {
  icon: LucideIcon;
  labelKey: string;
}

export const STAT_CARD_CONFIG: Record<StatCardKey, StatCardConfig> = {
  commits: { icon: GitCommit, labelKey: "devRecord.statCards.commits" },
  contributors: {
    icon: Users,
    labelKey: "devRecord.statCards.contributors",
  },
  filesChanged: {
    icon: FileDiff,
    labelKey: "devRecord.statCards.filesChanged",
  },
  linesChanged: {
    icon: Diff,
    labelKey: "devRecord.statCards.linesChanged",
  },
  sessions: { icon: History, labelKey: "devRecord.statCards.sessions" },
  filesTouched: {
    icon: FileDiff,
    labelKey: "devRecord.statCards.filesTouched",
  },
  streak: { icon: Flame, labelKey: "devRecord.statCards.streak" },
  tokensUsed: {
    icon: Coins,
    labelKey: "devRecord.statCards.tokensUsed",
  },
  modelsUsed: {
    icon: Cpu,
    labelKey: "devRecord.statCards.modelsUsed",
  },
  projects: {
    icon: FolderKanban,
    labelKey: "devRecord.statCards.projects",
  },
  codingTime: {
    icon: Clock,
    labelKey: "devRecord.statCards.codingTime",
  },
};
