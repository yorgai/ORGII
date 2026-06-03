import { Cloud, GitBranch, Laptop } from "lucide-react";
import React from "react";

import type { RunningLocation } from "@src/config/sessionCreatorConfig";

export const LOCATION_ICONS: Record<RunningLocation, React.ReactNode> = {
  local: <Laptop size={14} strokeWidth={1.75} className="text-text-1" />,
  worktree: <GitBranch size={14} strokeWidth={1.75} className="text-text-1" />,
  cloud: <Cloud size={14} strokeWidth={1.75} className="text-text-1" />,
};

export type LocationRow = { id: RunningLocation; disabled: boolean };
