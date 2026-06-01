import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
} from "react";

import type {
  LinearIssueSummary,
  LinearProjectSummary,
  LinearTeamSummary,
  LinearWorkflowStateSummary,
} from "@src/api/http/integrations";

import { cachedLinearProjectsApi } from "./linearProjectsCache";
import { errorMessage } from "./utils";

type Translate = (key: string) => string;

interface UseLinearProjectsLoadersOptions {
  connectionId?: string;
  projectId?: string;
  project: LinearProjectSummary | null;
  t: Translate;
  setProject: Dispatch<SetStateAction<LinearProjectSummary | null>>;
  setTeams: Dispatch<SetStateAction<LinearTeamSummary[]>>;
  setWorkflowStates: Dispatch<SetStateAction<LinearWorkflowStateSummary[]>>;
  setIssues: Dispatch<SetStateAction<LinearIssueSummary[]>>;
  setLoadingProject: Dispatch<SetStateAction<boolean>>;
  setLoadingIssues: Dispatch<SetStateAction<boolean>>;
  setLoadingWorkflowStates: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

interface LinearProjectsLoaders {
  loadProject: (forceRefresh?: boolean) => Promise<void>;
  loadIssues: (forceRefresh?: boolean) => Promise<void>;
  loadWorkflowStates: (forceRefresh?: boolean) => Promise<void>;
  handleRefresh: () => void;
}

export function useLinearProjectsLoaders({
  connectionId,
  projectId,
  project,
  t,
  setProject,
  setTeams,
  setWorkflowStates,
  setIssues,
  setLoadingProject,
  setLoadingIssues,
  setLoadingWorkflowStates,
  setError,
}: UseLinearProjectsLoadersOptions): LinearProjectsLoaders {
  const loadProject = useCallback(
    async (forceRefresh = false) => {
      if (!connectionId) {
        setProject(null);
        setTeams([]);
        return;
      }
      setLoadingProject(true);
      setError(null);
      try {
        const teamResult = await cachedLinearProjectsApi.listTeams(
          connectionId,
          {
            forceRefresh,
          }
        );
        setTeams(teamResult.teams);
        if (projectId) {
          const nextProject = await cachedLinearProjectsApi.getProject(
            connectionId,
            projectId,
            { forceRefresh }
          );
          setProject(nextProject);
        } else {
          setProject(null);
        }
      } catch (err) {
        setProject(null);
        setTeams([]);
        setError(errorMessage(err, t("linearProjects.errors.loadProjects")));
      } finally {
        setLoadingProject(false);
      }
    },
    [
      connectionId,
      projectId,
      setError,
      setLoadingProject,
      setProject,
      setTeams,
      t,
    ]
  );

  const loadIssues = useCallback(
    async (forceRefresh = false) => {
      if (!connectionId || !projectId) {
        setIssues([]);
        return;
      }
      setLoadingIssues(true);
      setError(null);
      try {
        const result = await cachedLinearProjectsApi.listProjectIssues(
          connectionId,
          projectId,
          { forceRefresh }
        );
        setIssues(result.issues);
      } catch (err) {
        setIssues([]);
        setError(errorMessage(err, t("linearProjects.errors.loadIssues")));
      } finally {
        setLoadingIssues(false);
      }
    },
    [connectionId, projectId, setError, setIssues, setLoadingIssues, t]
  );

  const loadWorkflowStates = useCallback(
    async (forceRefresh = false) => {
      const teamId = project?.teams[0]?.id;
      if (!connectionId || !teamId) {
        setWorkflowStates([]);
        return;
      }
      setLoadingWorkflowStates(true);
      setError(null);
      try {
        const result = await cachedLinearProjectsApi.listWorkflowStates(
          connectionId,
          teamId,
          { forceRefresh }
        );
        setWorkflowStates(result.states.filter((state) => !state.archived_at));
      } catch (err) {
        setWorkflowStates([]);
        setError(
          errorMessage(err, t("linearProjects.errors.loadWorkflowStates"))
        );
      } finally {
        setLoadingWorkflowStates(false);
      }
    },
    [
      connectionId,
      project?.teams,
      setError,
      setLoadingWorkflowStates,
      setWorkflowStates,
      t,
    ]
  );

  const handleRefresh = useCallback(() => {
    void loadProject(true);
    void loadIssues(true);
    void loadWorkflowStates(true);
  }, [loadIssues, loadProject, loadWorkflowStates]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    void loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    void loadWorkflowStates();
  }, [loadWorkflowStates]);

  return {
    loadProject,
    loadIssues,
    loadWorkflowStates,
    handleRefresh,
  };
}
