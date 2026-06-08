import { ICONS } from "../../config";
import type { SpotlightItem } from "../../types";
import {
  getWorkspacePathCandidate,
  getWorkspacePathDisplayName,
} from "./pathImport";

interface BuildOpenPathItemArgs {
  searchQuery: string;
  matchCount: number;
  addLabel: string;
  onOpenPath: (candidatePath: string) => void;
}

export function buildOpenPathItem({
  searchQuery,
  matchCount,
  addLabel,
  onOpenPath,
}: BuildOpenPathItemArgs): SpotlightItem | null {
  const candidatePath = getWorkspacePathCandidate(searchQuery);
  if (!candidatePath || matchCount > 0) return null;

  const folderName = getWorkspacePathDisplayName(candidatePath);

  return {
    id: "repo-open-path-candidate",
    label: `${addLabel} "${folderName}"`,
    desc: candidatePath,
    icon: ICONS.folder,
    type: "action",
    action: () => onOpenPath(candidatePath),
  };
}
