import {
  type WorkItemData,
  type WorkItemFrontmatter,
  projectApi,
} from "@src/api/http/project";
import { unresolveImagePathsForStorage } from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import {
  WORK_ITEM_STATUS,
  type WorkItem as WorkItemExtended,
} from "@src/types/core/workItem";

export interface CreatedWorkItemResult {
  keepOpen?: boolean;
  shortId: string;
  projectSlug?: string;
  item?: WorkItemData;
  workItem?: WorkItemExtended;
}

export interface CreateWorkItemFromDraftOptions {
  createMore?: boolean;
  defaultTitle?: string;
  description?: string;
  draft: WorkItemDraft;
  selectedProjectSlug?: string;
}

export async function createWorkItemFromDraft({
  createMore = false,
  defaultTitle,
  description,
  draft,
  selectedProjectSlug,
}: CreateWorkItemFromDraftOptions): Promise<CreatedWorkItemResult> {
  const title = draft.name.trim() || defaultTitle?.trim();
  if (!title) {
    throw new Error("Work item title is required");
  }

  const now = new Date().toISOString();
  const descriptionText = unresolveImagePathsForStorage(
    (description ?? draft.description).trim()
  );
  const shortId = selectedProjectSlug
    ? await projectApi.allocateWorkItemId(selectedProjectSlug)
    : await projectApi.allocateStandaloneWorkItemId();
  const frontmatter: WorkItemFrontmatter = {
    id: shortId,
    short_id: shortId,
    title,
    project: draft.projectId,
    status: draft.status || WORK_ITEM_STATUS.PLANNED,
    priority: draft.priority || "none",
    assignee: draft.assigneeId,
    assignee_type: draft.assigneeType,
    labels: draft.labelIds,
    milestone: draft.milestoneId,
    start_date: draft.startDate,
    target_date: draft.targetDate,
    created_by: undefined,
    created_at: now,
    updated_at: now,
    starred: false,
    todos: [],
    orchestrator_config: draft.orchestratorConfig,
    schedule: draft.schedule ?? undefined,
  };

  if (selectedProjectSlug) {
    await projectApi.writeWorkItem(
      selectedProjectSlug,
      shortId,
      frontmatter,
      descriptionText
    );
  } else {
    await projectApi.writeStandaloneWorkItem(
      shortId,
      frontmatter,
      descriptionText
    );
  }

  return {
    keepOpen: createMore,
    shortId,
    projectSlug: selectedProjectSlug,
    item: {
      frontmatter,
      body: descriptionText,
      filename: `${shortId}.md`,
    },
  };
}
