/**
 * Project Store
 *
 * State management for Projects (collections of work items).
 *
 * Features:
 * - Project list with filtering
 * - Selected project tracking
 * - Loading and error states
 */
import { atom } from "jotai";

import type {
  Project,
  ProjectHealth,
  ProjectPriority,
  ProjectStatus,
} from "@src/types/core/project";

// ============================================
// Filter Types
// ============================================

export interface ProjectFilter {
  status?: ProjectStatus[];
  priority?: ProjectPriority[];
  health?: ProjectHealth[];
  leadId?: string;
  search?: string;
}

// ============================================
// Core Atoms
// ============================================

/**
 * List of all projects
 */
export const projectsAtom = atom<Project[]>([]);
projectsAtom.debugLabel = "projectsAtom";

/**
 * Signal atom to trigger project list refresh.
 * Bump this value after creating/deleting a project so the sidebar re-fetches.
 */
export const projectListRefreshAtom = atom(0);
projectListRefreshAtom.debugLabel = "projectListRefreshAtom";

/**
 * Currently selected project ID
 */
export const selectedProjectIdAtom = atom<string | null>(null);
selectedProjectIdAtom.debugLabel = "selectedProjectIdAtom";

/**
 * Projects loading state
 */
export const projectsLoadingAtom = atom<boolean>(false);
projectsLoadingAtom.debugLabel = "projectsLoadingAtom";

/**
 * Projects error state
 */
export const projectsErrorAtom = atom<string | null>(null);
projectsErrorAtom.debugLabel = "projectsErrorAtom";

/**
 * Last time projects were loaded (for cache invalidation)
 */
export const projectsLastLoadedAtom = atom<number | null>(null);
projectsLastLoadedAtom.debugLabel = "projectsLastLoadedAtom";

// ============================================
// Filter Atoms
// ============================================

/**
 * Current filter string for projects
 */
export const projectSearchAtom = atom<string>("");
projectSearchAtom.debugLabel = "projectSearchAtom";

/**
 * Advanced filter options
 */
export const projectFilterAtom = atom<ProjectFilter>({});
projectFilterAtom.debugLabel = "projectFilterAtom";

// ============================================
// Derived Atoms
// ============================================

/**
 * Currently selected project (derived)
 */
export const selectedProjectAtom = atom<Project | null>((get) => {
  const projects = get(projectsAtom);
  const selectedId = get(selectedProjectIdAtom);
  if (!selectedId) return null;
  return projects.find((project) => project.id === selectedId) || null;
});
selectedProjectAtom.debugLabel = "selectedProjectAtom";

/**
 * Filtered projects list (derived)
 */
export const filteredProjectsAtom = atom((get) => {
  const projects = get(projectsAtom);
  const searchText = get(projectSearchAtom);
  const filter = get(projectFilterAtom);

  let filtered = projects;

  // Text search filter
  if (searchText) {
    const searchLower = searchText.toLowerCase();
    filtered = filtered.filter(
      (project) =>
        project.name.toLowerCase().includes(searchLower) ||
        project.description?.toLowerCase().includes(searchLower)
    );
  }

  // Status filter
  if (filter.status && filter.status.length > 0) {
    filtered = filtered.filter((project) =>
      filter.status!.includes(project.status)
    );
  }

  // Priority filter
  if (filter.priority && filter.priority.length > 0) {
    filtered = filtered.filter((project) =>
      filter.priority!.includes(project.priority)
    );
  }

  // Health filter
  if (filter.health && filter.health.length > 0) {
    filtered = filtered.filter((project) =>
      filter.health!.includes(project.health)
    );
  }

  // Lead filter
  if (filter.leadId) {
    filtered = filtered.filter((project) => project.lead?.id === filter.leadId);
  }

  return filtered;
});
filteredProjectsAtom.debugLabel = "filteredProjectsAtom";

/**
 * Projects grouped by status
 */
export const projectsByStatusAtom = atom((get) => {
  const projects = get(filteredProjectsAtom);
  const grouped = new Map<ProjectStatus, Project[]>();

  // Initialize all status groups
  const statuses: ProjectStatus[] = [
    "backlog",
    "planned",
    "in_progress",
    "completed",
    "canceled",
  ];
  statuses.forEach((status) => grouped.set(status, []));

  // Group projects
  projects.forEach((project) => {
    const group = grouped.get(project.status);
    if (group) {
      group.push(project);
    }
  });

  return grouped;
});
projectsByStatusAtom.debugLabel = "projectsByStatusAtom";

/**
 * Project count
 */
export const projectCountAtom = atom((get) => get(projectsAtom).length);
projectCountAtom.debugLabel = "projectCountAtom";

/**
 * Check if any projects exist
 */
export const hasProjectsAtom = atom((get) => get(projectsAtom).length > 0);
hasProjectsAtom.debugLabel = "hasProjectsAtom";

// ============================================
// Stats Atoms
// ============================================

/**
 * Project statistics
 */
export const projectStatsAtom = atom((get) => {
  const projects = get(projectsAtom);

  const byStatus = {
    backlog: 0,
    planned: 0,
    in_progress: 0,
    completed: 0,
    canceled: 0,
  };

  const byHealth = {
    on_track: 0,
    at_risk: 0,
    off_track: 0,
    no_updates: 0,
  };

  let totalWorkItems = 0;

  projects.forEach((project) => {
    byStatus[project.status]++;
    byHealth[project.health]++;
    totalWorkItems += project.workItemCount || 0;
  });

  return {
    total: projects.length,
    byStatus,
    byHealth,
    totalWorkItems,
    completionRate:
      projects.length > 0
        ? Math.round((byStatus.completed / projects.length) * 100)
        : 0,
  };
});
projectStatsAtom.debugLabel = "projectStatsAtom";

/**
 * Project map for O(1) lookups
 */
export const projectMapAtom = atom((get) => {
  const projects = get(projectsAtom);
  return new Map(projects.map((project) => [project.id, project]));
});
projectMapAtom.debugLabel = "projectMapAtom";
