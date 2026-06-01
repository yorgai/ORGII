import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";

import { linearProjectsApi } from "@src/api/http/integrations";
import type {
  LinearIssueSummary,
  LinearProjectSummary,
  LinearProjectUpdateRequest,
  LinearWorkflowStateCreateRequest,
  LinearWorkflowStateSummary,
  LinearWorkflowStateUpdateRequest,
} from "@src/api/http/integrations";
import type { WorkItem, WorkItemStatus } from "@src/types/core/workItem";

import { cachedLinearProjectsApi } from "./linearProjectsCache";
import { EMPTY_ISSUE_DRAFT, type IssueDraft, type ProjectDraft } from "./types";
import {
  errorMessage,
  hasUnsupportedLinearIssueUpdate,
  linearWorkflowStateForWorkItemStatus,
  workItemUpdatesToLinearIssueUpdate,
} from "./utils";

type Translate = (key: string) => string;

interface UseLinearProjectsMutationsOptions {
  connectionId?: string;
  projectId?: string;
  project: LinearProjectSummary | null;
  workflowStates: LinearWorkflowStateSummary[];
  projectDraft: ProjectDraft;
  issueDraft: IssueDraft;
  t: Translate;
  loadIssues: (forceRefresh?: boolean) => Promise<void>;
  setProject: Dispatch<SetStateAction<LinearProjectSummary | null>>;
  setIssues: Dispatch<SetStateAction<LinearIssueSummary[]>>;
  setWorkflowStates: Dispatch<SetStateAction<LinearWorkflowStateSummary[]>>;
  setSavingProject: Dispatch<SetStateAction<boolean>>;
  setSavingIssue: Dispatch<SetStateAction<boolean>>;
  setSavingWorkflowStateId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setCreatingProject: Dispatch<SetStateAction<boolean>>;
  setSelectedIssueId: Dispatch<SetStateAction<string | null>>;
  setIssueDraft: Dispatch<SetStateAction<IssueDraft>>;
}

export interface LinearProjectsMutations {
  handleCreateProject: () => Promise<void>;
  handleUpdateProject: (updates: LinearProjectUpdateRequest) => Promise<void>;
  handleCreateIssueForStatus: (status: WorkItemStatus) => Promise<void>;
  handleUpdateIssue: (
    issueId: string,
    updates: Partial<WorkItem>
  ) => Promise<void>;
  handleUpdateIssueWorkflowState: (
    issueId: string,
    stateId: string
  ) => Promise<void>;
  handleArchiveIssue: (issueId: string) => Promise<void>;
  handleCreateWorkflowState: (
    request: LinearWorkflowStateCreateRequest
  ) => Promise<void>;
  handleUpdateWorkflowState: (
    stateId: string,
    request: LinearWorkflowStateUpdateRequest
  ) => Promise<void>;
  handleArchiveWorkflowState: (stateId: string) => Promise<void>;
}

export function useLinearProjectsMutations({
  connectionId,
  projectId,
  project,
  workflowStates,
  projectDraft,
  issueDraft,
  t,
  loadIssues,
  setProject,
  setIssues,
  setWorkflowStates,
  setSavingProject,
  setSavingIssue,
  setSavingWorkflowStateId,
  setError,
  setCreatingProject,
  setSelectedIssueId,
  setIssueDraft,
}: UseLinearProjectsMutationsOptions): LinearProjectsMutations {
  const savingProjectCountRef = useRef(0);

  const handleCreateProject = useCallback(async () => {
    if (!connectionId) return;
    setSavingProject(true);
    setError(null);
    try {
      const created = await linearProjectsApi.createProject(connectionId, {
        name: projectDraft.name,
        description: projectDraft.description || undefined,
        team_ids: [projectDraft.teamId],
      });
      cachedLinearProjectsApi.rememberProject(connectionId, created);
      setProject(created);
      setCreatingProject(false);
    } catch (err) {
      setError(errorMessage(err, t("linearProjects.errors.createProject")));
    } finally {
      setSavingProject(false);
    }
  }, [
    connectionId,
    projectDraft,
    setCreatingProject,
    setError,
    setProject,
    setSavingProject,
    t,
  ]);

  const handleUpdateProject = useCallback(
    async (updates: LinearProjectUpdateRequest) => {
      if (!connectionId || !project) return;
      const pid = project.id;
      savingProjectCountRef.current += 1;
      setSavingProject(true);
      setError(null);
      try {
        const updated = await linearProjectsApi.updateProject(
          connectionId,
          pid,
          updates
        );
        cachedLinearProjectsApi.rememberProject(connectionId, updated);
        setProject((current) => {
          if (!current || current.id !== pid) return current;
          return {
            ...current,
            name: updates.name !== undefined ? updated.name : current.name,
            description:
              updates.description !== undefined
                ? updated.description
                : current.description,
            status: updated.status ?? current.status,
            lead: updates.lead_id !== undefined ? updated.lead : current.lead,
            start_date:
              updates.start_date !== undefined
                ? updated.start_date
                : current.start_date,
            target_date:
              updates.target_date !== undefined
                ? updated.target_date
                : current.target_date,
            updated_at: updated.updated_at ?? current.updated_at,
          };
        });
      } catch (err) {
        setError(errorMessage(err, t("linearProjects.errors.updateProject")));
        throw err;
      } finally {
        savingProjectCountRef.current = Math.max(
          0,
          savingProjectCountRef.current - 1
        );
        setSavingProject(savingProjectCountRef.current > 0);
      }
    },
    [connectionId, project, setError, setProject, setSavingProject, t]
  );

  const handleCreateIssueForStatus = useCallback(
    async (status: WorkItemStatus) => {
      if (!connectionId || !project) return;
      const teamId = project.teams[0]?.id ?? projectDraft.teamId;
      if (!teamId) return;
      const matchingState = linearWorkflowStateForWorkItemStatus(
        status,
        workflowStates
      );
      setSavingIssue(true);
      setError(null);
      try {
        const created = await linearProjectsApi.createIssue(connectionId, {
          title: issueDraft.title || t("workItems.newWorkItemName"),
          description: issueDraft.description || undefined,
          team_id: teamId,
          project_id: project.id,
          state_id: matchingState?.id,
        });
        cachedLinearProjectsApi.invalidateProjectIssues(
          connectionId,
          project.id
        );
        setIssues((current) => [created, ...current]);
        setIssueDraft(EMPTY_ISSUE_DRAFT);
        setSelectedIssueId(created.id);
      } catch (err) {
        setError(errorMessage(err, t("linearProjects.errors.createIssue")));
      } finally {
        setSavingIssue(false);
      }
    },
    [
      connectionId,
      issueDraft,
      project,
      projectDraft.teamId,
      setError,
      setIssueDraft,
      setIssues,
      setSavingIssue,
      setSelectedIssueId,
      t,
      workflowStates,
    ]
  );

  const handleUpdateIssue = useCallback(
    async (issueId: string, updates: Partial<WorkItem>) => {
      if (!connectionId) return;
      if (hasUnsupportedLinearIssueUpdate(updates)) {
        const err = new Error(
          t("linearProjects.errors.unsupportedIssueUpdate")
        );
        setError(err.message);
        throw err;
      }
      const request = workItemUpdatesToLinearIssueUpdate(
        updates,
        workflowStates
      );
      if (updates.workItemStatus !== undefined && !request.state_id) {
        const err = new Error(t("linearProjects.errors.statusStateMissing"));
        setError(err.message);
        throw err;
      }
      if (Object.keys(request).length === 0) return;
      setSavingIssue(true);
      setError(null);
      try {
        const updated = await linearProjectsApi.updateIssue(
          connectionId,
          issueId,
          request
        );
        if (projectId) {
          cachedLinearProjectsApi.invalidateProjectIssues(
            connectionId,
            projectId
          );
        }
        setIssues((current) =>
          current.map((issue) => (issue.id === issueId ? updated : issue))
        );
      } catch (err) {
        setError(errorMessage(err, t("linearProjects.errors.updateIssue")));
        throw err;
      } finally {
        setSavingIssue(false);
      }
    },
    [
      connectionId,
      projectId,
      setError,
      setIssues,
      setSavingIssue,
      t,
      workflowStates,
    ]
  );

  const handleUpdateIssueWorkflowState = useCallback(
    async (issueId: string, stateId: string) => {
      if (!connectionId) return;
      setSavingIssue(true);
      setError(null);
      try {
        const updated = await linearProjectsApi.updateIssue(
          connectionId,
          issueId,
          { state_id: stateId }
        );
        if (projectId) {
          cachedLinearProjectsApi.invalidateProjectIssues(
            connectionId,
            projectId
          );
        }
        setIssues((current) =>
          current.map((issue) => (issue.id === issueId ? updated : issue))
        );
      } catch (err) {
        setError(errorMessage(err, t("linearProjects.errors.updateIssue")));
        throw err;
      } finally {
        setSavingIssue(false);
      }
    },
    [connectionId, projectId, setError, setIssues, setSavingIssue, t]
  );

  const handleArchiveIssue = useCallback(
    async (issueId: string) => {
      if (!connectionId) return;
      setSavingIssue(true);
      setError(null);
      try {
        await linearProjectsApi.archiveIssue(connectionId, issueId);
        if (projectId) {
          cachedLinearProjectsApi.invalidateProjectIssues(
            connectionId,
            projectId
          );
        }
        setIssues((current) => current.filter((issue) => issue.id !== issueId));
        setSelectedIssueId((current) => (current === issueId ? null : current));
      } catch (err) {
        setError(errorMessage(err, t("linearProjects.errors.archiveIssue")));
      } finally {
        setSavingIssue(false);
      }
    },
    [
      connectionId,
      projectId,
      setError,
      setIssues,
      setSavingIssue,
      setSelectedIssueId,
      t,
    ]
  );

  const handleCreateWorkflowState = useCallback(
    async (request: LinearWorkflowStateCreateRequest) => {
      if (!connectionId) return;
      setSavingWorkflowStateId("new");
      setError(null);
      try {
        const created = await linearProjectsApi.createWorkflowState(
          connectionId,
          request
        );
        cachedLinearProjectsApi.invalidateWorkflowStates(
          connectionId,
          request.team_id
        );
        setWorkflowStates((current) => [...current, created]);
      } catch (err) {
        setError(
          errorMessage(err, t("linearProjects.errors.createWorkflowState"))
        );
      } finally {
        setSavingWorkflowStateId(null);
      }
    },
    [connectionId, setError, setSavingWorkflowStateId, setWorkflowStates, t]
  );

  const handleUpdateWorkflowState = useCallback(
    async (stateId: string, request: LinearWorkflowStateUpdateRequest) => {
      if (!connectionId) return;
      setSavingWorkflowStateId(stateId);
      setError(null);
      try {
        const updated = await linearProjectsApi.updateWorkflowState(
          connectionId,
          stateId,
          request
        );
        if (updated.team?.id) {
          cachedLinearProjectsApi.invalidateWorkflowStates(
            connectionId,
            updated.team.id
          );
        }
        if (projectId) {
          cachedLinearProjectsApi.invalidateProjectIssues(
            connectionId,
            projectId
          );
        }
        setWorkflowStates((current) =>
          current.map((state) => (state.id === stateId ? updated : state))
        );
        setIssues((current) =>
          current.map((issue) =>
            issue.state?.id === stateId
              ? {
                  ...issue,
                  state: {
                    id: updated.id,
                    name: updated.name,
                    type: updated.type,
                  },
                }
              : issue
          )
        );
      } catch (err) {
        setError(
          errorMessage(err, t("linearProjects.errors.updateWorkflowState"))
        );
      } finally {
        setSavingWorkflowStateId(null);
      }
    },
    [
      connectionId,
      projectId,
      setError,
      setIssues,
      setSavingWorkflowStateId,
      setWorkflowStates,
      t,
    ]
  );

  const handleArchiveWorkflowState = useCallback(
    async (stateId: string) => {
      if (!connectionId) return;
      setSavingWorkflowStateId(stateId);
      setError(null);
      try {
        await linearProjectsApi.archiveWorkflowState(connectionId, stateId);
        const archivedState = workflowStates.find(
          (state) => state.id === stateId
        );
        if (archivedState?.team?.id) {
          cachedLinearProjectsApi.invalidateWorkflowStates(
            connectionId,
            archivedState.team.id
          );
        }
        if (projectId) {
          cachedLinearProjectsApi.invalidateProjectIssues(
            connectionId,
            projectId
          );
        }
        setWorkflowStates((current) =>
          current.filter((state) => state.id !== stateId)
        );
        void loadIssues(true);
      } catch (err) {
        setError(
          errorMessage(err, t("linearProjects.errors.archiveWorkflowState"))
        );
      } finally {
        setSavingWorkflowStateId(null);
      }
    },
    [
      connectionId,
      loadIssues,
      projectId,
      setError,
      setSavingWorkflowStateId,
      setWorkflowStates,
      t,
      workflowStates,
    ]
  );

  return {
    handleCreateProject,
    handleUpdateProject,
    handleCreateIssueForStatus,
    handleUpdateIssue,
    handleUpdateIssueWorkflowState,
    handleArchiveIssue,
    handleCreateWorkflowState,
    handleUpdateWorkflowState,
    handleArchiveWorkflowState,
  };
}
