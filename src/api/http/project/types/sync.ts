export const PROJECT_ORG_SYNC_PROVIDER = {
  GIT_FOLDER: "git_folder",
} as const;

export interface ConfigureProjectOrgGitFolderSyncRequest {
  org_id: string;
  folder_path: string;
}

export interface SyncProjectOrgGitFolderRequest {
  org_id: string;
}

export interface ResolveProjectOrgGitFolderConflictRequest {
  org_id: string;
  file_path: string;
  content: string;
}

export const PROJECT_GIT_FOLDER_SYNC_STATUS = {
  SYNCED: "synced",
  BLOCKED: "blocked",
} as const;

export type ProjectGitFolderSyncStatus =
  (typeof PROJECT_GIT_FOLDER_SYNC_STATUS)[keyof typeof PROJECT_GIT_FOLDER_SYNC_STATUS];

export const PROJECT_GIT_FOLDER_CONFLICT_KIND = {
  GIT_MARKER: "git_marker",
  PARSE_ERROR: "parse_error",
  RECORD_DIVERGED: "record_diverged",
} as const;

export type ProjectGitFolderConflictKind =
  (typeof PROJECT_GIT_FOLDER_CONFLICT_KIND)[keyof typeof PROJECT_GIT_FOLDER_CONFLICT_KIND];

export const PROJECT_GIT_FOLDER_CONFLICT_ENTITY_TYPE = {
  ORG: "org",
  PROJECT: "project",
  WORK_ITEM: "work_item",
} as const;

export type ProjectGitFolderConflictEntityType =
  (typeof PROJECT_GIT_FOLDER_CONFLICT_ENTITY_TYPE)[keyof typeof PROJECT_GIT_FOLDER_CONFLICT_ENTITY_TYPE];

export interface ProjectGitFolderSyncConflict {
  id: string;
  kind: ProjectGitFolderConflictKind;
  entity_type: ProjectGitFolderConflictEntityType;
  file_path: string;
  relative_path: string;
  message: string;
  project_slug?: string;
  work_item_short_id?: string;
  content?: string;
}

export interface SyncProjectOrgGitFolderResult {
  org_id: string;
  folder_path: string;
  status: ProjectGitFolderSyncStatus;
  conflicts: ProjectGitFolderSyncConflict[];
  last_synced_at?: string;
  projects_exported: number;
  projects_imported: number;
  work_items_exported: number;
  work_items_imported: number;
}
