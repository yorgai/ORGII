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
import { Info, X } from "lucide-react";
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
  projectApi,
} from "@src/api/http/project";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Select, { type SelectOption } from "@src/components/Select";
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
  ProjectContentTitleInput,
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

interface CreateWorkItemProjectOption extends WorkItemProject {
  slug?: string;
  orgId?: string;
}

const CREATE_WORK_ITEM_VISIBLE_FIELDS: WorkItemPropertyFieldKey[] = [
  "project",
  "status",
  "priority",
  "assignee",
  "reviewer",
  "milestone",
  "startDate",
  "date",
  "labels",
];

const CREATE_WORK_ITEM_INLINE_FIELDS: WorkItemPropertyFieldKey[] = [
  "project",
  "status",
  "priority",
];

const CREATE_WORK_ITEM_HEADER_ACTION_CLASS =
  "hover:!bg-fill-2 !h-7 !w-7 !min-w-7";
const CREATE_WORK_ITEM_HEADER_ACTION_ACTIVE_CLASS =
  "!h-7 !w-7 !min-w-7 !bg-surface-selected !text-primary-6 hover:!bg-fill-2";
const CREATE_WORK_ITEM_BREADCRUMB_SELECT_CLASS =
  "w-auto max-w-[220px] [&_.select-selector]:!h-7 [&_.select-selector]:!rounded-full [&_.select-selector]:!border-0 [&_.select-selector]:!bg-transparent [&_.select-selector]:!px-1.5 [&_.select-selector]:!text-[12px] [&_.select-selector]:!shadow-none hover:[&_.select-selector]:!bg-surface-hover";

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
  /** Called when the local draft changes. */
  onDraftChange?: (draft: WorkItemDraft) => void;
  /** Available options for pickers */
  availableProjects?: WorkItemProject[];
  availableMilestones?: WorkItemMilestone[];
  availableLabels?: WorkItemLabel[];
  availableMembers?: Person[];
  /** Publish page header into the global WorkstationTabHeader. */
  publishHeaderToWorkstation?: boolean;
  /** Render the close action in the local header. */
  showCloseAction?: boolean;
  /** Whether the right properties panel is visible. Defaults to false for creation. */
  propertiesOpen?: boolean;
  /** Callback to toggle the right properties panel. */
  onToggleProperties?: () => void;
  /** Render the local properties info action in this view's header. */
  showPropertiesAction?: boolean;
  /** Controlled agent creation mode. */
  aiGenerateMode?: boolean;
  /** Controlled agent creation mode change handler. */
  onAiGenerateModeChange?: (enabled: boolean) => void;
  /** Render the local agent mode card. */
  showAiModePanel?: boolean;
  /** Optional content rendered below the shared title/description editor. */
  contentSlot?: React.ReactNode;
  /** Render the create footer. */
  showFooter?: boolean;
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
  onDraftChange,
  availableProjects = [],
  availableMilestones = [],
  availableLabels = [],
  availableMembers = [],
  publishHeaderToWorkstation = false,
  showCloseAction = true,
  propertiesOpen,
  onToggleProperties,
  showPropertiesAction = true,
  aiGenerateMode: controlledAiGenerateMode,
  onAiGenerateModeChange,
  showAiModePanel = true,
  contentSlot,
  showFooter = true,
}) => {
  const { t } = useTranslation("projects");
  const [saving, setSaving] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [localAiGenerateMode, setLocalAiGenerateMode] = useState(true);
  const [localPropertiesOpen, setLocalPropertiesOpen] = useState(false);
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

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

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
  const selectedProjectOrgId = selectedProject?.orgId;
  const selectedProjectOrgLabel =
    projectOrgs.find((org) => org.id === selectedProjectOrgId)?.name ??
    scopeBreadcrumbLabel ??
    t("orgs.personalOrg");

  const projectBreadcrumbLabel =
    selectedProjectName || t("projects.dashboardTitle");

  const projectOptions = useMemo<SelectOption[]>(
    () =>
      resolvedProjects.map((project) => ({
        value: project.id,
        label: project.name,
        triggerLabel: project.name,
      })),
    [resolvedProjects]
  );

  const orgOptions = useMemo<SelectOption[]>(() => {
    const orgIdsWithProjects = new Set(
      resolvedProjects
        .map((project) => project.orgId)
        .filter((orgId): orgId is string => Boolean(orgId))
    );
    return projectOrgs
      .filter((org) => orgIdsWithProjects.has(org.id))
      .map((org) => ({
        value: org.id,
        label: org.name,
        triggerLabel: org.name,
      }));
  }, [projectOrgs, resolvedProjects]);

  const handleProjectBreadcrumbChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      updateDraftWithUndo({ projectId: String(value) });
    },
    [updateDraftWithUndo]
  );

  const handleOrgBreadcrumbChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      const nextOrgId = String(value);
      const nextProject = resolvedProjects.find(
        (project) => project.orgId === nextOrgId
      );
      if (nextProject) {
        updateDraftWithUndo({ projectId: nextProject.id });
      }
    },
    [resolvedProjects, updateDraftWithUndo]
  );

  const orgBreadcrumbSegment =
    orgOptions.length > 0 ? (
      <Select
        value={selectedProjectOrgId}
        options={orgOptions}
        onChange={handleOrgBreadcrumbChange}
        placeholder={selectedProjectOrgLabel}
        size="small"
        variant="ghost"
        radius="pill"
        showSearch
        dropdownWidthMode="min-match"
        dropdownMinWidth={220}
        panelZIndex={10000}
        className={CREATE_WORK_ITEM_BREADCRUMB_SELECT_CLASS}
        dataTestId="create-work-item-org-breadcrumb-select"
      />
    ) : (
      selectedProjectOrgLabel
    );

  const projectBreadcrumbSegment =
    projectOptions.length > 0 ? (
      <Select
        value={draft.projectId}
        options={projectOptions}
        onChange={handleProjectBreadcrumbChange}
        placeholder={projectBreadcrumbLabel}
        size="small"
        variant="ghost"
        radius="pill"
        showSearch
        dropdownWidthMode="min-match"
        dropdownMinWidth={220}
        panelZIndex={10000}
        className={CREATE_WORK_ITEM_BREADCRUMB_SELECT_CLASS}
        dataTestId="create-work-item-project-breadcrumb-select"
      />
    ) : (
      projectBreadcrumbLabel
    );

  // Build a stub WorkItemExtended for WorkItemProperties from the draft
  const stubWorkItem = workItemDraftToStubWorkItem(draft, selectedProjectName);
  const resolvedPropertiesOpen = propertiesOpen ?? localPropertiesOpen;
  const resolvedAiGenerateMode =
    controlledAiGenerateMode ?? localAiGenerateMode;

  const handleAiGenerateModeChange = useCallback(
    (enabled: boolean) => {
      if (onAiGenerateModeChange) {
        onAiGenerateModeChange(enabled);
        return;
      }
      setLocalAiGenerateMode(enabled);
    },
    [onAiGenerateModeChange]
  );

  const handleToggleProperties = useCallback(() => {
    if (onToggleProperties) {
      onToggleProperties();
      return;
    }
    setLocalPropertiesOpen((current) => !current);
  }, [onToggleProperties]);

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
    selectedProjectSlug,
    onWorkItemCreated,
    clearDraft,
    resetDraftForCreateMore,
    saving,
  ]);

  useKeyboardSave(handleCreate, !saving && !!draft.name.trim());

  const workItemTitlePlaceholder = t("workItems.titlePlaceholder");
  const optionalWorkItemTitlePlaceholder = `${workItemTitlePlaceholder} (${t("common:optional")})`;

  const sharedWorkItemEditor = contentSlot ? (
    <div className="shrink-0 px-4 pt-4" data-testid="create-work-item-editor">
      <ProjectContentTitleInput
        title={draft.name}
        onTitleChange={handleTitleChange}
        titlePlaceholder={optionalWorkItemTitlePlaceholder}
        autoFocusTitle
      />
      <div className="mb-4 mt-2 w-full border-t border-border-2" />
    </div>
  ) : (
    <ProjectContentEditor
      key={editorResetKey}
      ref={editorRef}
      title={draft.name}
      onTitleChange={handleTitleChange}
      initialDescription={draft.description || ""}
      onDescriptionChange={handleDescriptionChange}
      titlePlaceholder={workItemTitlePlaceholder}
      descriptionPlaceholder={t("workItems.descriptionPlaceholder")}
      onImageInsert={handleImageInsert}
      descriptionClassName="no-bottom-border"
      descriptionMaxHeight="100%"
      repoPath={repoPath}
      className="flex min-h-0 flex-1 flex-col"
      autoFocusTitle
      dataTestId="create-work-item-editor"
    />
  );

  return (
    <DetailSplitLayout
      title={t("workItems.newWorkItem")}
      breadcrumb={[
        orgBreadcrumbSegment,
        projectBreadcrumbSegment,
        t("workItems.newWorkItem"),
      ]}
      borderlessHeader
      publishHeaderToWorkstation={publishHeaderToWorkstation}
      headerActions={
        <>
          {showPropertiesAction ? (
            <Button
              {...PANEL_HEADER_TOKENS.actionButton}
              className={
                resolvedPropertiesOpen
                  ? CREATE_WORK_ITEM_HEADER_ACTION_ACTIVE_CLASS
                  : CREATE_WORK_ITEM_HEADER_ACTION_CLASS
              }
              icon={
                <Info
                  size={PANEL_HEADER_TOKENS.buttonIconSize}
                  strokeWidth={PANEL_HEADER_TOKENS.iconStrokeWidth}
                />
              }
              onClick={handleToggleProperties}
              title={
                resolvedPropertiesOpen
                  ? t("workItems.hideProperties")
                  : t("workItems.showProperties")
              }
              aria-label={
                resolvedPropertiesOpen
                  ? t("workItems.hideProperties")
                  : t("workItems.showProperties")
              }
              aria-pressed={resolvedPropertiesOpen}
              htmlType="button"
            />
          ) : null}
          {showCloseAction ? (
            <Button
              {...PANEL_HEADER_TOKENS.actionButton}
              className={CREATE_WORK_ITEM_HEADER_ACTION_CLASS}
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
          ) : null}
        </>
      }
      leftContent={
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {showAiModePanel ? (
            <div className="border-b border-solid border-border-1 px-4 py-2">
              <div
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-container px-3 py-2"
                data-testid="create-work-item-mode-panel"
              >
                <span className="text-[12px] font-medium text-text-1">
                  {t("workItems.createModes.useAi")}
                </span>
                <Switch
                  size="small"
                  checked={resolvedAiGenerateMode}
                  onChange={handleAiGenerateModeChange}
                  ariaLabel={t("workItems.createModes.useAi")}
                  dataTestId="create-work-item-mode-ai-switch"
                />
              </div>
            </div>
          ) : null}
          <div
            className={`flex min-h-0 flex-1 flex-col ${contentSlot ? "px-0 pt-0" : "px-4 pt-4"}`}
          >
            {sharedWorkItemEditor}
            {contentSlot ? (
              <div className="min-h-0 flex-1">{contentSlot}</div>
            ) : null}
            {!resolvedPropertiesOpen && (
              <div
                className={`${contentSlot ? "px-4" : ""} shrink-0 pb-3 pt-2`}
                data-testid="create-work-item-property-pills"
              >
                <WorkItemProperties
                  workItem={stubWorkItem}
                  onUpdate={handlePropertyUpdate}
                  availableProjects={resolvedProjects}
                  availableMilestones={availableMilestones}
                  availableLabels={resolvedLabels}
                  availableMembers={resolvedMembers}
                  availableAgents={customAgents}
                  availableOrgs={availableOrgs}
                  visibleFields={CREATE_WORK_ITEM_INLINE_FIELDS}
                  fieldVariant="pill"
                  showMoreMenu
                />
              </div>
            )}
          </div>
        </div>
      }
      rightContent={
        resolvedPropertiesOpen ? (
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
        ) : undefined
      }
      resizableRightPanel={resolvedPropertiesOpen}
      footer={
        showFooter ? (
          <>
            <label className="mr-2 flex items-center gap-2 text-[12px] text-text-2">
              <Switch
                size="small"
                checked={createMore}
                onChange={(checked) => setCreateMore(checked)}
                dataTestId="create-work-item-auto-execute-switch"
              />
              <span>
                {resolvedAiGenerateMode
                  ? "Auto execute"
                  : t("projects.createMore")}
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
                : resolvedAiGenerateMode
                  ? "Generate Work Items"
                  : t("workItems.createWorkItem")}
            </Button>
          </>
        ) : undefined
      }
    />
  );
};

export default CreateWorkItemView;
