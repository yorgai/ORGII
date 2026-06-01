import type { GitFileInfo } from "@/src/store/git";

import type { TreePanelNode } from "@src/components/TreePanelSidebar/types";

export type { GitFileInfo };

export interface TreeNodeProps {
  node: TreePanelNode;
  depth: number;
  onSelectNode: (path: string, node: TreePanelNode) => void;
  onToggleDirectory: (path: string) => void;
  isRenaming?: boolean;
  onRenameConfirm?: (oldPath: string, newName: string) => void;
  onRenameCancel?: () => void;
}

export type DispatchFn = (
  actionType: string,
  payload: Record<string, unknown>,
  source: "user" | "ai" | "system"
) => Promise<unknown>;

export interface FileTreeContentProps {
  treeData: TreePanelNode[];
  selectedPath: string | null;
  repoPath?: string | null;
  onSelectNode: (path: string, node: TreePanelNode) => void;
  onToggleDirectory: (path: string) => void;
  filterQuery: string;
  onFilterChange: (query: string) => void;
  filterPlaceholder?: string;
  showFilter?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  noResultsMessage?: string;
  revealPath?: string | null;
  revealKey?: number | null;
  dispatch?: DispatchFn;
  isMultiRoot?: boolean;
}

export interface FlattenedNode {
  node: TreePanelNode;
  depth: number;
}

export interface GitStatusContextValue {
  statusMap: Map<string, GitFileInfo>;
  folderStatusMap: Map<string, string>;
  repoPath: string | null;
  isMultiRoot: boolean;
}

export interface CreatingNewState {
  parentDir: string;
  isFolder: boolean;
}

export interface FileTreeContentHandle {
  startCreatingNew: (parentDir: string, isFolder: boolean) => void;
}
