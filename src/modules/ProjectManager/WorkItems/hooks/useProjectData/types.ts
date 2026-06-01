/**
 * useProjectData Types
 */
import type { MemberEntry } from "@src/api/http/project";
import type { ProjectData } from "@src/modules/ProjectManager/shared";
import type { Label, Person, Team } from "@src/types/core/shared";
import type {
  WorkItemMilestone,
  WorkItemProject,
} from "@src/types/core/workItem";

// Re-export for consumers
export type { WorkItemMilestone, WorkItemProject };

export interface UseProjectDataOptions {
  projectId?: string | null;
  autoLoad?: boolean;
  /** Whether this tab is currently visible (gates background refresh on hidden tabs) */
  isActive?: boolean;
}

export interface UseProjectDataReturn {
  project: ProjectData | null;
  loading: boolean;
  error: string | null;
  availableMembers: Person[];
  availableTeams: Team[];
  availableLabels: Label[];
  availableProjects: WorkItemProject[];
  availableMilestones: WorkItemMilestone[];
  /** Raw `MemberEntry[]` for the active project */
  rawMembers: MemberEntry[];
  /** Raw `Label[]` for the active project */
  rawLabels: Label[];
  refresh: () => Promise<void>;
  updateProject: (updates: Partial<ProjectData>) => Promise<boolean>;
  updateMembers: (members: MemberEntry[]) => Promise<void>;
  updateLabels: (labels: Label[]) => Promise<void>;
  selectProject: (projectId: string) => void;
  /** Always empty — kept for legacy callers iterating an "API projects" list */
  projects: unknown[];
  selectedProjectId: string | null;
}
