/**
 * Project Manager Store
 *
 * State management for the Project Manager Workstation app.
 * Provides draft caching for create forms.
 */
export {
  // Types
  type ProjectDraft,
  type WorkItemDraft,
  // Default factories
  createDefaultProjectDraft,
  createDefaultWorkItemDraft,
  // Atoms
  projectDraftsAtom,
  workItemDraftsAtom,
  // Write atoms
  setProjectDraftAtom,
  patchProjectDraftAtom,
  removeProjectDraftAtom,
  PROJECT_CREATOR_DRAFT_ID,
  setWorkItemDraftAtom,
  patchWorkItemDraftAtom,
  removeWorkItemDraftAtom,
  WORK_ITEM_CREATOR_DRAFT_ID,
} from "./drafts";
