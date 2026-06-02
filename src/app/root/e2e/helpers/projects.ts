import { invoke } from "@tauri-apps/api/core";

import {
  type ProjectMeta,
  type RoutineDefinition,
  type WorkItemFrontmatter,
  projectApi,
} from "@src/api/http/project";
import {
  activeSessionIdAtom,
  workstationActiveSessionIdAtom,
} from "@src/store/session/viewAtom";

import { asError } from "../result";
import type { E2EStore, Err, Json, Result } from "../types";

export function createProjectHelpers(store: E2EStore) {
  const writeProject = async (
    slug: string,
    meta: Json,
    description: string,
    expectNew?: boolean
  ): Promise<{ ok: true } | Err> => {
    try {
      await projectApi.writeProject(
        slug,
        meta as unknown as ProjectMeta,
        description,
        expectNew
      );
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const deleteProject = async (slug: string): Promise<{ ok: true } | Err> => {
    try {
      await projectApi.deleteProject(slug);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const listRoutines = async (): Promise<Result<{ routines: Json[] }>> => {
    try {
      const routines = (await projectApi.listRoutines()) as unknown as Json[];
      return { ok: true, routines };
    } catch (err) {
      return asError(err);
    }
  };

  const upsertRoutine = async (
    routine: Json
  ): Promise<Result<{ routine: Json }>> => {
    try {
      const savedRoutine = (await projectApi.upsertRoutine(
        routine as unknown as RoutineDefinition
      )) as unknown as Json;
      return { ok: true, routine: savedRoutine };
    } catch (err) {
      return asError(err);
    }
  };

  const deleteRoutine = async (
    routineId: string
  ): Promise<Result<{ removed: boolean }>> => {
    try {
      const removed = await projectApi.deleteRoutine(routineId);
      return { ok: true, removed };
    } catch (err) {
      return asError(err);
    }
  };

  const fireRoutine = async (
    routineId: string
  ): Promise<Result<{ result: Json }>> => {
    try {
      const result = (await projectApi.fireRoutine(
        routineId
      )) as unknown as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  const listRoutineFires = async (
    routineId: string
  ): Promise<Result<{ fires: Json[] }>> => {
    try {
      const fires = (await projectApi.listRoutineFires(
        routineId
      )) as unknown as Json[];
      return { ok: true, fires };
    } catch (err) {
      return asError(err);
    }
  };

  const readWorkItem = async (
    projectSlug: string,
    shortId: string
  ): Promise<Result<{ item: Json }>> => {
    try {
      const item = (await projectApi.readWorkItem(
        projectSlug,
        shortId
      )) as unknown as Json;
      return { ok: true, item };
    } catch (err) {
      return asError(err);
    }
  };

  const writeWorkItem = async (
    projectSlug: string,
    shortId: string,
    frontmatter: Json,
    body: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await projectApi.writeWorkItem(
        projectSlug,
        shortId,
        frontmatter as unknown as WorkItemFrontmatter,
        body
      );
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const deleteWorkItem = async (
    projectSlug: string,
    shortId: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await projectApi.deleteWorkItem(projectSlug, shortId);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const readWorkItemsEnriched = async (
    projectSlug: string
  ): Promise<Result<{ items: Json[] }>> => {
    try {
      const items = (await projectApi.readWorkItemsEnriched(
        projectSlug
      )) as unknown as Json[];
      return { ok: true, items };
    } catch (err) {
      return asError(err);
    }
  };

  const runWorkItemSchedulerOnce = async (): Promise<
    Result<{ result: Json }>
  > => {
    try {
      const result = (await invoke(
        "debug_work_item_scheduler_run_once"
      )) as Json;
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  const testWorkItemScheduleLookup = async (
    projectName: string,
    title: string
  ): Promise<Result<Json>> => {
    try {
      const projects = (await invoke("project_read_stories")) as Array<{
        slug?: string;
        meta?: { name?: string };
      }>;
      const project = projects.find(
        (candidate) =>
          candidate.slug === projectName || candidate.meta?.name === projectName
      );
      if (!project?.slug) {
        return { ok: false, error: `Project not found: ${projectName}` };
      }
      const items = (await projectApi.readWorkItemsEnriched(
        project.slug
      )) as unknown as Json[];
      const matches = items.filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return false;
        }
        return (item as { title?: unknown }).title === title;
      });
      return {
        ok: true,
        projectSlug: project.slug,
        matches,
      };
    } catch (err) {
      return asError(err);
    }
  };

  const launchWorkItemRuntimeProbe = async (
    params: Json
  ): Promise<Result<{ result: Json }>> => {
    try {
      const result = (await invoke("debug_work_item_runtime_launch", {
        request: params,
      })) as Json;
      if (typeof result.sessionId === "string") {
        store.set(activeSessionIdAtom, result.sessionId);
        store.set(workstationActiveSessionIdAtom, result.sessionId);
      }
      return { ok: true, result };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    writeProject,
    deleteProject,
    listRoutines,
    upsertRoutine,
    deleteRoutine,
    fireRoutine,
    listRoutineFires,
    readWorkItem,
    writeWorkItem,
    deleteWorkItem,
    readWorkItemsEnriched,
    testWorkItemScheduleLookup,
    runWorkItemSchedulerOnce,
    launchWorkItemRuntimeProbe,
  };
}
