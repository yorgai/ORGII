import { GitCommit, History, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { DevRecordView } from "@src/store/ui/devRecordToolbarAtom";

export interface DevRecordViewConfig {
  key: DevRecordView;
  labelKey: string;
  icon: LucideIcon;
}

export const DEV_RECORD_VIEW_ITEMS: readonly DevRecordViewConfig[] = [
  {
    key: "git-dashboard",
    labelKey: "navigation:routes.gitDashboard",
    icon: GitCommit,
  },
  { key: "sessions", labelKey: "sessions.title", icon: History },
  { key: "other-usage", labelKey: "otherUsage.title", icon: Sparkles },
];

export function getDevRecordViewConfig(
  view: DevRecordView
): DevRecordViewConfig | undefined {
  return DEV_RECORD_VIEW_ITEMS.find((item) => item.key === view);
}
