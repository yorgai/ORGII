import { ICONS } from "../../config";
import type { SpotlightItem } from "../../types";
import {
  getWorkspacePathCandidate,
  getWorkspacePathDisplayName,
} from "./pathImport";

interface BuildOpenPathItemArgs {
  searchQuery: string;
  matchCount: number;
  openLabel: string;
  onOpenPath: (candidatePath: string) => void;
}

export function buildOpenPathItem({
  searchQuery,
  matchCount,
  openLabel,
  onOpenPath,
}: BuildOpenPathItemArgs): SpotlightItem | null {
  const candidatePath = getWorkspacePathCandidate(searchQuery);
  if (!candidatePath || matchCount > 0) return null;

  return {
    id: "repo-open-path-candidate",
    label: `${openLabel} ${getWorkspacePathDisplayName(candidatePath)}`,
    desc: candidatePath,
    icon: ICONS.folder,
    type: "action",
    action: () => onOpenPath(candidatePath),
  };
}
