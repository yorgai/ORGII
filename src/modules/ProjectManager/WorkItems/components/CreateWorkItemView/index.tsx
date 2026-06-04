/**
 * CreateWorkItemView Component
 *
 * Work item creation form reused by Project Manager modals.
 * Draft state is managed by `useWorkItemCreatorDraft`.
 *
 * Handles its own centralized project-store write logic.
 *
 * Split layout:
 *   - Header: title + close button
 *   - Left: title and detail editor for description
 *   - Right: WorkItemProperties (status, priority, assignee, project, etc.)
 *   - Footer: Cancel / Create work item
 */
import { emit } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type ProjectOrg,
  type WorkItemData,
  type WorkItemFrontmatter,
  enrichedWorkItemToUI,
  projectApi,
} from "@src/api/http/project";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import Switch from "@src/components/Switch";
import { useKeyboardSave } from "@src/hooks/keyboard";
import { createLogger } from "@src/hooks/logger";
import {
  mapWorkItemUpdatesToDraftPatch,
  useWorkItemCreatorDraft,
  useWorkItemImageInsert,
  workItemDraftToStubWorkItem,
} from "@src/hooks/project";
import { useUndoStackWithRestore } from "@src/hooks/ui";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import {
  DetailSplitLayout,
  ProjectContentEditor,
  type ProjectContentEditorRef,
} from "@src/modules/ProjectManager/shared";
import { unresolveImagePathsForStorage } from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import { PANEL_HEADER_TOKENS } from "@src/modules/shared/layouts/blocks";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { Person } from "@src/types/core/shared";
import {
  WORK_ITEM_STATUS,
  type WorkItem as WorkItemExtended,
  type WorkItemLabel,
  type WorkItemMilestone,
  type WorkItemProject,
} from "@src/types/core/workItem";

import WorkItemProperties from "../WorkItemProperties";
import type { WorkItemPropertyFieldKey } from "../WorkItemProperties/types";

// ============================================
// Types
// ============================================

export interface CreatedWorkItemResult {
  keepOpen?: boolean;
  shortId: string;
  projectSlug?: string;
  item?: WorkItemData;
  workItem?: WorkItemExtended;
}

interface LinkableWorkItem {
  shortId: string;
  projectSlug?: string;
  title: string;
  description: string;
  item?: WorkItemData;
  workItem?: WorkItemExtended;
}

interface CreateWorkItemProjectOption extends WorkItemProject {
  slug?: string;
  orgId?: string;
}

const CREATE_WORK_ITEM_VISIBLE_FIELDS: WorkItemPropertyFieldKey[] = [
  "status",
  "priority",
  "assignee",
  "reviewer",
  "project",
  "milestone",
  "startDate",
  "date",
  "labels",
];

export interface CreateWorkItemViewProps {
  /** Project ID for the new work item when launched from a Project */
  projectId?: string;
  /** Project slug used by the backend project store when Project-scoped */
  projectSlug?: string;
  /** Project name for display when Project-scoped */
  projectName?: string;
  /** Workspace path used by editor context menus. */
  repoPath?: string | null;
  /** Scope label for breadcrumb display. */
  scopeBreadcrumbLabel?: string;
  /** Cancel / discard the draft and close the tab */
  onCancel: () => void;
  /** Mark this tab as having unsaved changes */
  onSetUnsaved: (hasUnsaved: boolean) => void;
  /** Called after work item is successfully created */
  onWorkItemCreated: (result?: CreatedWorkItemResult) => void;
  /** Enables selecting an existing Work Item as the parent for the new item. */
  onLinkWorkItem?: (result: CreatedWorkItemResult) => void;
  /** Available options for pickers */
  availableProjects?: WorkItemProject[];
  availableMilestones?: WorkItemMilestone[];
  availableLabels?: WorkItemLabel[];
  availableMembers?: Person[];
  /** Publish page header into the global WorkstationTabHeader. */
  publishHeaderToWorkstation?: boolean;
  /** Render the close action in the local header. */
  showCloseAction?: boolean;
}

// ============================================
// Component
// ============================================

const logger = createLogger("CreateWorkItemView");

const CreateWorkItemView: React.FC<CreateWorkItemViewProps> = ({
  projectId,
  projectSlug,
  projectName,
  repoPath,
  scopeBreadcrumbLabel,
  onCancel,
  onSetUnsaved,
  onWorkItemCreated,
  onLinkWorkItem,
  availableProjects = [],
  availableMilestones = [],
  availableLabels = [],
  availableMembers = [],
  publishHeaderToWorkstation = false,
  showCloseAction = true,
}) => {
  const { t } = useTranslation("projects");
  const [saving, setSaving] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [aiGenerateMode, setAiGenerateMode] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const { agents: customAgents } = useAgentDefinitions();
  const { orgs: availableOrgs } = useAgentOrgs();

  // Self-load members/labels/projects when parent doesn't supply them
  const [loadedMembers, setLoadedMembers] = useState<Person[]>([]);
  const [loadedProjects, setLoadedProjects] = useState<
    CreateWorkItemProjectOption[]
  >([]);
  const [projectOrgs, setProjectOrgs] = useState<ProjectOrg[]>([]);
  const [loadedProjectSlugById, setLoadedProjectSlugById] = useState<
    Record<string, string>
  >({});
  const [loadedLabels, setLoadedLabels] = useState<WorkItemLabel[]>([]);
  const [linkableWorkItems, setLinkableWorkItems] = useState<
    LinkableWorkItem[]
  >([]);
  const [linkedWorkItemKey, setLinkedWorkItemKey] = useState<string | null>(
    null
  );

  const defaultProjectId =
    projectId ?? availableProjects[0]?.id ?? loadedProjects[0]?.id;
  const { draft, updateDraft, setDraft, resetDraft, clearDraft } =
    useWorkItemCreatorDraft({
      seedProjectId: projectId,
      defaultProjectId,
      onSetUnsaved,
    });

  const selectedProjectSlug =
    draft.projectId && draft.projectId === projectId
      ? projectSlug
      : draft.projectId
        ? loadedProjectSlugById[draft.projectId]
        : undefined;

  const editorRef = useRef<ProjectContentEditorRef>(null);

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: selectedProjectSlug ?? "",
    editorRef,
  });

  useEffect(() => {
    if (availableProjects.length > 0) return;
    let cancelled = false;

    const loadProjects = async () => {
      try {
        const [projectsData, orgsData] = await Promise.all([
          projectApi.readProjects(),
          projectApi.readOrgs(),
        ]);
        if (cancelled) return;
        setLoadedProjects(
          projectsData.map((project) => ({
            id: project.meta.id,
            name: project.meta.name,
            slug: project.slug,
            orgId: project.meta.org_id,
          }))
        );
        setProjectOrgs(orgsData);
        setLoadedProjectSlugById(
          Object.fromEntries(
            projectsData.map((project) => [project.meta.id, project.slug])
          )
        );
      } catch (err) {
        logger.warn("Failed to load projects for work item picker", err);
      }
    };

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [availableProjects.length]);

  useEffect(() => {
    if (!onLinkWorkItem) return;
    let cancelled = false;

    const loadLinkableWorkItems = async () => {
      try {
        const [projectsData, standaloneItems] = await Promise.all([
          projectApi.readProjects(),
          projectApi.readStandaloneWorkItems(),
        ]);
        const projectItems = await Promise.all(
          projectsData.map(async (project) => {
            const items = await projectApi.readWorkItemsEnriched(project.slug);
            return items.map<LinkableWorkItem>((item) => ({
              shortId: item.shortId,
              projectSlug: project.slug,
              title: item.title,
              description: project.meta.name,
              workItem: enrichedWorkItemToUI(item),
            }));
          })
        );
        if (cancelled) return;
        setLinkableWorkItems([
          ...projectItems.flat(),
          ...standaloneItems.map<LinkableWorkItem>((item) => ({
            shortId: item.frontmatter.short_id || item.frontmatter.id,
            title: item.frontmatter.title,
            description: "Standalone Work Item",
            item,
          })),
        ]);
      } catch (err) {
        logger.warn("Failed to load existing work items for linking", err);
      }
    };

    loadLinkableWorkItems();
    return () => {
      cancelled = true;
    };
  }, [onLinkWorkItem]);

  useEffect(() => {
    if (availableMembers.length > 0 || !selectedProjectSlug) return;
    let cancelled = false;

    const loadProjectLookups = async () => {
      try {
        const [membersFile, labelsFile] = await Promise.all([
          projectApi.readMembers(selectedProjectSlug),
          projectApi.readLabels(selectedProjectSlug),
        ]);
        if (cancelled) return;

        const activeMembers: Person[] = membersFile.members
          .filter((member) => member.active !== false)
          .map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            avatar: member.avatar,
          }));
        setLoadedMembers(activeMembers);

        setLoadedLabels(
          labelsFile.labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
          }))
        );
      } catch (err) {
        logger.warn("Failed to load project metadata for pickers", err);
      }
    };

    loadProjectLookups();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectSlug, availableMembers.length]);

  const resolvedMembers =
    availableMembers.length > 0 ? availableMembers : loadedMembers;
  const resolvedProjects: CreateWorkItemProjectOption[] =
    availableProjects.length > 0 ? availableProjects : loadedProjects;
  const resolvedLabels =
    availableLabels.length > 0 ? availableLabels : loadedLabels;

  const sortedLinkableWorkItems = useMemo(
    () =>
      [...linkableWorkItems]
        .filter((item) => item.title.trim().length > 0)
        .sort((left, right) => left.title.localeCompare(right.title))
        .slice(0, 8),
    [linkableWorkItems]
  );

  const getLinkableWorkItemKey = useCallback(
    (item: LinkableWorkItem) =>
      `${item.projectSlug ?? "standalone"}:${item.shortId}`,
    []
  );

  const linkableWorkItemByKey = useMemo(
    () =>
      new Map(
        sortedLinkableWorkItems.map((item) => [
          getLinkableWorkItemKey(item),
          item,
        ])
      ),
    [getLinkableWorkItemKey, sortedLinkableWorkItems]
  );

  const linkableWorkItemOptions = useMemo<SelectOption[]>(
    () =>
      sortedLinkableWorkItems.map((item) => ({
        value: getLinkableWorkItemKey(item),
        label: (
          <span className="flex min-w-0 flex-col items-start">
            <span className="max-w-full truncate text-[12px] font-medium text-text-1">
              {item.title}
            </span>
            <span className="max-w-full truncate text-[11px] text-text-3">
              {item.description || item.shortId}
            </span>
          </span>
        ),
        triggerLabel: item.title,
        dataTestId: `create-work-item-link-existing-${item.shortId}`,
      })),
    [getLinkableWorkItemKey, sortedLinkableWorkItems]
  );

  const handleLinkExistingWorkItemChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      const key = String(value);
      if (!linkableWorkItemByKey.has(key)) return;
      setLinkedWorkItemKey(key);
    },
    [linkableWorkItemByKey]
  );

  // Undo/redo for property changes (keyboard shortcut auto-restores)
  const undoStack = useUndoStackWithRestore<WorkItemDraft>({
    keyboardShortcut: true,
    currentValue: draft,
    onRestore: (prev) => setDraft(prev),
  });

  const updateDraftWithUndo = useCallback(
    (updates: Partial<WorkItemDraft>) => {
      undoStack.snapshot(draft);
      updateDraft(updates);
    },
    [draft, undoStack, updateDraft]
  );

  // Field handlers
  const handleTitleChange = useCallback(
    (name: string) => updateDraftWithUndo({ name }),
    [updateDraftWithUndo]
  );

  const handleDescriptionChange = useCallback(
    (markdown: string, _text: string) =>
      updateDraftWithUndo({ description: markdown }),
    [updateDraftWithUndo]
  );

  const selectedProject = resolvedProjects.find(
    (project) => project.id === draft.projectId
  );
  const selectedProjectName = selectedProject?.name ?? projectName ?? "";
  const selectedProjectOrgLabel =
    projectOrgs.find((org) => org.id === selectedProject?.orgId)?.name ??
    scopeBreadcrumbLabel ??
    t("orgs.personalOrg");

  const projectBreadcrumbLabel =
    selectedProjectName || t("projects.dashboardTitle");

  // Build a stub WorkItemExtended for WorkItemProperties from the draft
  const stubWorkItem = workItemDraftToStubWorkItem(draft, selectedProjectName);

  const handlePropertyUpdate = useCallback(
    (updates: Partial<WorkItemExtended>) => {
      updateDraftWithUndo(mapWorkItemUpdatesToDraftPatch(updates));
    },
    [updateDraftWithUndo]
  );

  const resetDraftForCreateMore = useCallback(() => {
    resetDraft(defaultProjectId);
    setEditorResetKey((value) => value + 1);
  }, [defaultProjectId, resetDraft]);

  const handleCreate = useCallback(async () => {
    if (!draft.name.trim() || saving) return;

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const rawMarkdown =
        editorRef.current?.getMarkdown()?.trim() ?? draft.description;
      const descriptionText = unresolveImagePathsForStorage(rawMarkdown);

      const shortId = selectedProjectSlug
        ? await projectApi.allocateWorkItemId(selectedProjectSlug)
        : await projectApi.allocateStandaloneWorkItemId();
      const linkedWorkItem = linkedWorkItemKey
        ? linkableWorkItemByKey.get(linkedWorkItemKey)
        : undefined;
      const frontmatter: WorkItemFrontmatter = {
        id: shortId,
        short_id: shortId,
        title: draft.name.trim(),
        project: draft.projectId,
        status: draft.status || WORK_ITEM_STATUS.PLANNED,
        priority: draft.priority || "none",
        assignee: draft.assigneeId,
        assignee_type: draft.assigneeType,
        labels: draft.labelIds,
        milestone: draft.milestoneId,
        parent: linkedWorkItem?.shortId,
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

      const createdItem: WorkItemData = {
        frontmatter,
        body: descriptionText,
        filename: `${shortId}.md`,
      };
      const result: CreatedWorkItemResult = {
        keepOpen: createMore,
        shortId,
        projectSlug: selectedProjectSlug,
        item: createdItem,
      };

      await emit("orgii-data-changed");
      if (createMore) {
        resetDraftForCreateMore();
        onWorkItemCreated(result);
      } else {
        clearDraft();
        onWorkItemCreated(result);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to create work item", err);
      Message.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    createMore,
    draft,
    linkedWorkItemKey,
    linkableWorkItemByKey,
    selectedProjectSlug,
    onWorkItemCreated,
    clearDraft,
    resetDraftForCreateMore,
    saving,
  ]);

  useKeyboardSave(handleCreate, !saving && !!draft.name.trim());

  return (
    <DetailSplitLayout
      title={t("workItems.newWorkItem")}
      breadcrumb={[
        selectedProjectOrgLabel,
        projectBreadcrumbLabel,
        t("workItems.newWorkItem"),
      ]}
      borderlessHeader
      publishHeaderToWorkstation={publishHeaderToWorkstation}
      headerActions={
        showCloseAction ? (
          <Button
            {...PANEL_HEADER_TOKENS.actionButton}
            icon={
              <X
                size={PANEL_HEADER_TOKENS.buttonIconSize}
                strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
              />
            }
            onClick={onCancel}
            title={t("common:actions.close")}
            htmlType="button"
          />
        ) : null
      }
      leftContent={
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="border-b border-solid border-border-1 px-4 py-2">
            <div
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-container px-3 py-2"
              data-testid="create-work-item-mode-panel"
            >
              <span className="text-[12px] font-medium text-text-1">
                {t("workItems.createModes.generateWithAi")}
              </span>
              <Switch
                size="small"
                checked={aiGenerateMode}
                onChange={setAiGenerateMode}
                ariaLabel={t("workItems.createModes.generateWithAi")}
                dataTestId="create-work-item-mode-ai-switch"
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
            <ProjectContentEditor
              key={editorResetKey}
              ref={editorRef}
              title={draft.name}
              onTitleChange={handleTitleChange}
              initialDescription={draft.description || ""}
              onDescriptionChange={handleDescriptionChange}
              titlePlaceholder={
                aiGenerateMode
                  ? "What should we build or break down?"
                  : t("workItems.titlePlaceholder")
              }
              descriptionPlaceholder={
                aiGenerateMode
                  ? "Describe requirements, repo/project scope, desired granularity, dependencies, and whether the generated work items should auto-execute."
                  : t("workItems.descriptionPlaceholder")
              }
              onImageInsert={handleImageInsert}
              descriptionClassName="no-bottom-border"
              descriptionMaxHeight="100%"
              repoPath={repoPath}
              className="flex min-h-0 flex-1 flex-col"
              autoFocusTitle
              dataTestId="create-work-item-editor"
            />
            {onLinkWorkItem && linkableWorkItemOptions.length > 0 && (
              <div
                className="shrink-0 pb-3 pt-2"
                data-testid="create-work-item-link-existing-panel"
              >
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-text-3">
                  {t("workItems.linkExisting.label")}
                </label>
                <Select
                  value={linkedWorkItemKey ?? undefined}
                  options={linkableWorkItemOptions}
                  onChange={handleLinkExistingWorkItemChange}
                  placeholder={t("workItems.linkExisting.placeholder")}
                  size="small"
                  radius="lg"
                  showSearch
                  dropdownWidthMode="match"
                  panelZIndex={10000}
                  dataTestId="create-work-item-link-existing-select"
                  selectorClassName="!bg-surface-container"
                />
              </div>
            )}
          </div>
        </div>
      }
      rightContent={
        <WorkItemProperties
          workItem={stubWorkItem}
          onUpdate={handlePropertyUpdate}
          availableProjects={resolvedProjects}
          availableMilestones={availableMilestones}
          availableLabels={resolvedLabels}
          availableMembers={resolvedMembers}
          availableAgents={customAgents}
          availableOrgs={availableOrgs}
          visibleFields={CREATE_WORK_ITEM_VISIBLE_FIELDS}
        />
      }
      footer={
        <>
          <label className="mr-2 flex items-center gap-2 text-[12px] text-text-2">
            <Switch
              size="small"
              checked={createMore}
              onChange={(checked) => setCreateMore(checked)}
              dataTestId="create-work-item-auto-execute-switch"
            />
            <span>
              {aiGenerateMode ? "Auto execute" : t("projects.createMore")}
            </span>
          </label>
          <Button
            variant="primary"
            size="small"
            onClick={handleCreate}
            disabled={!draft.name.trim() || saving}
            data-testid="create-work-item-submit"
          >
            {saving
              ? t("common:status.saving")
              : aiGenerateMode
                ? "Generate Work Items"
                : t("workItems.createWorkItem")}
          </Button>
        </>
      }
    />
  );
};

export default CreateWorkItemView;
