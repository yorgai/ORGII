import type React from "react";

import type { AddWorkspaceModalStage } from "../../hooks";
import type { BasePaletteProps } from "../../shared";
import type { RepoItem } from "../../types";

export type AddMenuKind = "add" | null;

export const REPO_PALETTE_SECTION_KEY = {
  CURRENT: "current",
  SYSTEM_PATH: "systemPath",
  REPO: "repo",
  MULTI_REPO_WORKSPACE: "multiRepoWorkspace",
} as const;

export type RepoPaletteSectionKey =
  (typeof REPO_PALETTE_SECTION_KEY)[keyof typeof REPO_PALETTE_SECTION_KEY];

export interface RepoPaletteProps extends BasePaletteProps {
  onSelect: (repoId: string, repo: RepoItem) => void;
  currentRepoId?: string;
  initialAddStage?: AddWorkspaceModalStage;
  initialAddMenu?: boolean;
  initialManageMode?: boolean;
  topSlot?: React.ReactNode;
  asBody?: boolean;
  switchPathLabel?: string;
  hideActionClose?: boolean;
  leadingRepos?: readonly RepoItem[];
}

export interface RepoPaletteText {
  switchPathLabel: string;
  switchPathTemplate: string;
  switchPlaceholder: string;
  invalidPathTitle: string;
  invalidPathMessage: (path: string) => string;
  addPathLabel: string;
  addPathTemplate: string;
  addPlaceholder: string;
  addEntryLabel: string;
  openFolderLabel: string;
  sectionCurrentLabel: string;
  sectionSystemPathsLabel: string;
  sectionRepoLabel: string;
  sectionMultiRepoWorkspaceLabel: string;
}
