import { invoke } from "@tauri-apps/api/core";

export interface LinearPageInfo {
  has_next_page: boolean;
  end_cursor: string | null;
}

export interface LinearUserSummary {
  id: string;
  name: string;
  email?: string;
}

export interface LinearTeamSummary {
  id: string;
  name: string;
  key: string;
}

export interface LinearLabelSummary {
  id: string;
  name: string;
  color?: string;
}

export type LinearProjectStatusType =
  | "backlog"
  | "planned"
  | "started"
  | "completed"
  | "canceled";

export interface LinearProjectStatusSummary {
  id: string;
  name: string;
  type?: LinearProjectStatusType;
  color?: string;
}

export interface LinearProjectSummary {
  id: string;
  name: string;
  description?: string;
  status?: LinearProjectStatusSummary;
  slug_id?: string;
  url?: string;
  icon?: string;
  color?: string;
  start_date?: string;
  target_date?: string;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  lead?: LinearUserSummary;
  teams: LinearTeamSummary[];
}

export interface LinearProjectListResult {
  projects: LinearProjectSummary[];
  page_info: LinearPageInfo;
}

export interface LinearTeamListResult {
  teams: LinearTeamSummary[];
  page_info: LinearPageInfo;
}

export type LinearWorkflowStateType =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface LinearWorkflowStateSummary {
  id: string;
  name: string;
  description?: string;
  type?: LinearWorkflowStateType;
  color?: string;
  position?: number;
  archived_at?: string;
  team?: LinearTeamSummary;
}

export interface LinearWorkflowStateListResult {
  states: LinearWorkflowStateSummary[];
  page_info: LinearPageInfo;
}

export interface LinearIssueState {
  id: string;
  name: string;
  type?: LinearWorkflowStateType;
}

export interface LinearProjectRef {
  id: string;
  name: string;
}

export interface LinearIssueSummary {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number;
  url?: string;
  created_at?: string;
  updated_at?: string;
  archived_at?: string;
  state?: LinearIssueState;
  assignee?: LinearUserSummary;
  project?: LinearProjectRef;
  team?: LinearTeamSummary;
  labels: LinearLabelSummary[];
}

export interface LinearIssueListResult {
  issues: LinearIssueSummary[];
  page_info: LinearPageInfo;
}

export interface LinearProjectCreateRequest {
  name: string;
  description?: string;
  team_ids: string[];
  lead_id?: string;
  start_date?: string;
  target_date?: string;
}

export interface LinearProjectUpdateRequest {
  name?: string;
  description?: string | null;
  lead_id?: string | null;
  start_date?: string | null;
  target_date?: string | null;
}

export interface LinearWorkflowStateCreateRequest {
  team_id: string;
  name: string;
  description?: string;
  color?: string;
  state_type?: LinearWorkflowStateType;
  position?: number;
}

export interface LinearWorkflowStateUpdateRequest {
  name?: string;
  description?: string;
  color?: string;
  state_type?: LinearWorkflowStateType;
  position?: number;
}

export interface LinearIssueCreateRequest {
  title: string;
  team_id: string;
  project_id: string;
  description?: string;
  priority?: number;
  estimate?: number;
  state_id?: string;
}

export interface LinearIssueUpdateRequest {
  title?: string;
  description?: string;
  priority?: number;
  estimate?: number;
  state_id?: string;
}

export const linearProjectsApi = {
  listProjects(
    connectionId: string,
    cursor?: string | null,
    forceRefresh = false
  ): Promise<LinearProjectListResult> {
    return invoke("linear_projects_list", {
      connectionId,
      cursor: cursor ?? null,
      forceRefresh,
    });
  },

  getProject(
    connectionId: string,
    projectId: string,
    forceRefresh = false
  ): Promise<LinearProjectSummary> {
    return invoke("linear_project_get", {
      connectionId,
      projectId,
      forceRefresh,
    });
  },

  listTeams(
    connectionId: string,
    cursor?: string | null,
    forceRefresh = false
  ): Promise<LinearTeamListResult> {
    return invoke("linear_teams_list", {
      connectionId,
      cursor: cursor ?? null,
      forceRefresh,
    });
  },

  listWorkflowStates(
    connectionId: string,
    teamId: string,
    forceRefresh = false
  ): Promise<LinearWorkflowStateListResult> {
    return invoke("linear_workflow_states_list", {
      connectionId,
      teamId,
      forceRefresh,
    });
  },

  createWorkflowState(
    connectionId: string,
    request: LinearWorkflowStateCreateRequest
  ): Promise<LinearWorkflowStateSummary> {
    return invoke("linear_workflow_state_create", { connectionId, request });
  },

  updateWorkflowState(
    connectionId: string,
    stateId: string,
    request: LinearWorkflowStateUpdateRequest
  ): Promise<LinearWorkflowStateSummary> {
    return invoke("linear_workflow_state_update", {
      connectionId,
      stateId,
      request,
    });
  },

  archiveWorkflowState(
    connectionId: string,
    stateId: string
  ): Promise<LinearWorkflowStateSummary> {
    return invoke("linear_workflow_state_archive", { connectionId, stateId });
  },

  createProject(
    connectionId: string,
    request: LinearProjectCreateRequest
  ): Promise<LinearProjectSummary> {
    return invoke("linear_project_create", { connectionId, request });
  },

  updateProject(
    connectionId: string,
    projectId: string,
    request: LinearProjectUpdateRequest
  ): Promise<LinearProjectSummary> {
    return invoke("linear_project_update", {
      connectionId,
      projectId,
      request,
    });
  },

  archiveProject(connectionId: string, projectId: string): Promise<void> {
    return invoke("linear_project_archive", { connectionId, projectId });
  },

  listProjectIssues(
    connectionId: string,
    projectId: string,
    cursor?: string | null,
    forceRefresh = false
  ): Promise<LinearIssueListResult> {
    return invoke("linear_project_issues_list", {
      connectionId,
      projectId,
      cursor: cursor ?? null,
      forceRefresh,
    });
  },

  createIssue(
    connectionId: string,
    request: LinearIssueCreateRequest
  ): Promise<LinearIssueSummary> {
    return invoke("linear_issue_create", { connectionId, request });
  },

  updateIssue(
    connectionId: string,
    issueId: string,
    request: LinearIssueUpdateRequest
  ): Promise<LinearIssueSummary> {
    return invoke("linear_issue_update", { connectionId, issueId, request });
  },

  archiveIssue(connectionId: string, issueId: string): Promise<void> {
    return invoke("linear_issue_archive", { connectionId, issueId });
  },
};

export default linearProjectsApi;
