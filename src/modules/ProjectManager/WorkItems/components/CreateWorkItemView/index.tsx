/**
 * CreateWorkItemView Component
 *
 * Work item creation form reused by Project Manager modals.
 * Draft state is shared with the chat-panel work item creator via
 * `useWorkItemCreatorDraft` (single jotai entry).
 *
 * Handles its own centralized project-store write logic.
 *
 * Split layout:
 *   - Header: title + close button
 *   - Left: Title input + MarkdownEditor for description
 *   - Right: WorkItemProperties (status, priority, assignee, project, etc.)
 *   - Footer: Cancel / Create work item
 */
import { emit } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type WorkItemFrontmatter, projectApi } from "@src/api/http/project";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
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
import { DetailSplitLayout } from "@src/modules/ProjectManager/shared";
import { PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS } from "@src/modules/ProjectManager/shared/placeholderTokens";
import { unresolveImagePathsForStorage } from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import MarkdownEditor from "@src/modules/shared/components/MarkdownEditor";
import type { MarkdownEditorRef } from "@src/modules/shared/components/MarkdownEditor";
import { PANEL_HEADER_TOKENS } from "@src/modules/shared/layouts/blocks";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
  WorkItemProject,
} from "@src/types/core/workItem";

import WorkItemProperties from "../WorkItemProperties";

// ============================================
// Types
// ============================================

export interface CreateWorkItemViewProps {
  /** Project ID for the new work item when launched from a Project */
  projectId?: string;
  /** Project slug used by the backend project store when Project-scoped */
  projectSlug?: string;
  /** Project name for display when Project-scoped */
  projectName?: string;
  /** Scope label for breadcrumb display. */
  scopeBreadcrumbLabel?: string;
  /** Cancel / discard the draft and close the tab */
  onCancel: () => void;
  /** Mark this tab as having unsaved changes */
  onSetUnsaved: (hasUnsaved: boolean) => void;
  /** Called after work item is successfully created */
  onWorkItemCreated: (options?: { keepOpen?: boolean }) => void;
  /** Available options for pickers */
  availableProjects?: WorkItemProject[];
  availableMilestones?: WorkItemMilestone[];
  availableLabels?: WorkItemLabel[];
  availableMembers?: Person[];
  /** Publish page header into the global WorkstationTabHeader. */
  publishHeaderToWorkstation?: boolean;
}

// ============================================
// Component
// ============================================

const logger = createLogger("CreateWorkItemView");

const CreateWorkItemView: React.FC<CreateWorkItemViewProps> = ({
  projectId,
  projectSlug,
  projectName,
  scopeBreadcrumbLabel,
  onCancel,
  onSetUnsaved,
  onWorkItemCreated,
  availableProjects = [],
  availableMilestones = [],
  availableLabels = [],
  availableMembers = [],
  publishHeaderToWorkstation = false,
}) => {
  const { t } = useTranslation("projects");
  const [saving, setSaving] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const [editorResetKey, setEditorResetKey] = useState(0);
  const { agents: customAgents } = useAgentDefinitions();
  const { orgs: availableOrgs } = useAgentOrgs();

  const { draft, updateDraft, setDraft, resetDraft, clearDraft } =
    useWorkItemCreatorDraft({
      seedProjectId: projectId,
      onSetUnsaved,
    });

  const editorRef = useRef<MarkdownEditorRef>(null);

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: projectSlug ?? "",
    editorRef,
  });

  // Self-load members/labels/projects when parent doesn't supply them
  const [loadedMembers, setLoadedMembers] = useState<Person[]>([]);
  const [loadedProjects, setLoadedProjects] = useState<WorkItemProject[]>([]);
  const [loadedProjectSlugById, setLoadedProjectSlugById] = useState<
    Record<string, string>
  >({});
  const [loadedLabels, setLoadedLabels] = useState<WorkItemLabel[]>([]);

  useEffect(() => {
    if (availableProjects.length > 0) return;
    let cancelled = false;

    const loadProjects = async () => {
      try {
        const projectsData = await projectApi.readProjects();
        if (cancelled) return;
        setLoadedProjects(
          projectsData.map((project) => ({
            id: project.meta.id,
            name: project.meta.name,
          }))
        );
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
    if (availableMembers.length > 0 || !projectSlug) return;
    let cancelled = false;

    const loadProjectLookups = async () => {
      try {
        const [membersFile, labelsFile] = await Promise.all([
          projectApi.readMembers(projectSlug),
          projectApi.readLabels(projectSlug),
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
  }, [projectSlug, availableMembers.length]);

  const resolvedMembers =
    availableMembers.length > 0 ? availableMembers : loadedMembers;
  const resolvedProjects =
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
    (html: string) => updateDraftWithUndo({ description: html }),
    [updateDraftWithUndo]
  );

  const selectedProjectName =
    resolvedProjects.find((project) => project.id === draft.projectId)?.name ??
    projectName ??
    "";

  const projectOptions = resolvedProjects.map<SelectOption>((project) => ({
    value: project.id,
    label: project.name,
    triggerLabel: project.name,
  }));

  const handleProjectChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      updateDraftWithUndo({ projectId: String(value) });
    },
    [updateDraftWithUndo]
  );

  const projectBreadcrumbPill = (
    <Select
      value={draft.projectId}
      options={projectOptions}
      onChange={handleProjectChange}
      placeholder={
        selectedProjectName || t("workItems.properties.selectProject")
      }
      size="small"
      radius="pill"
      showSearch
      dropdownWidthMode="min-match"
      dropdownMinWidth={220}
      // CreateWorkItemView renders inside the WorkItem create Modal
      // (z-index 9999). Without bumping the panel z-index the dropdown
      // sits behind the modal mask and never appears to the user.
      panelZIndex={10000}
      className="w-auto max-w-[220px] [&_.select-selector]:!h-7 [&_.select-selector]:!rounded-full [&_.select-selector]:!bg-bg-2 [&_.select-selector]:!px-3 [&_.select-selector]:!text-[13px] [&_.select-selector]:!font-medium [&_.select-selector]:!shadow-none"
    />
  );

  // Build a stub WorkItemExtended for WorkItemProperties from the draft
  const stubWorkItem = workItemDraftToStubWorkItem(draft, selectedProjectName);

  const handlePropertyUpdate = useCallback(
    (updates: Partial<WorkItemExtended>) => {
      updateDraftWithUndo(mapWorkItemUpdatesToDraftPatch(updates));
    },
    [updateDraftWithUndo]
  );

  const resetDraftForCreateMore = useCallback(() => {
    resetDraft(projectId);
    setEditorResetKey((value) => value + 1);
  }, [projectId, resetDraft]);

  const handleCreate = useCallback(async () => {
    if (!draft.name.trim() || saving) return;

    setSaving(true);
    try {
      const selectedProjectSlug =
        draft.projectId && draft.projectId === projectId
          ? projectSlug
          : draft.projectId
            ? loadedProjectSlugById[draft.projectId]
            : undefined;
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
        status: draft.status || "backlog",
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

      await emit("orgii-data-changed");
      if (createMore) {
        resetDraftForCreateMore();
        onWorkItemCreated({ keepOpen: true });
      } else {
        clearDraft();
        onWorkItemCreated();
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
    loadedProjectSlugById,
    onWorkItemCreated,
    clearDraft,
    resetDraftForCreateMore,
    saving,
    projectId,
    projectSlug,
  ]);

  useKeyboardSave(handleCreate, !saving && !!draft.name.trim());

  return (
    <DetailSplitLayout
      title={t("workItems.newWorkItem")}
      breadcrumb={[
        ...(scopeBreadcrumbLabel ? [scopeBreadcrumbLabel] : []),
        projectBreadcrumbPill,
        t("workItems.newWorkItem"),
      ]}
      borderlessHeader
      publishHeaderToWorkstation={publishHeaderToWorkstation}
      headerActions={
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
      }
      leftContent={
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-4">
            <Input
              type="text"
              value={draft.name}
              onChange={handleTitleChange}
              placeholder={t("workItems.titlePlaceholder")}
              autoFocus
              borderless
              bgless
              autoHeight
              className="mb-1 shrink-0"
              inputClassName={`text-[22px] font-semibold text-text-1 ${PROJECT_MANAGER_TEXT_PLACEHOLDER_CLASS}`}
            />

            <div className="mb-4 mt-2 shrink-0 border-t border-border-2" />

            <div
              className="min-h-0 flex-1 cursor-text"
              onClick={() => editorRef.current?.focus()}
            >
              <MarkdownEditor
                key={editorResetKey}
                ref={editorRef}
                value={draft.description || ""}
                onChange={handleDescriptionChange}
                placeholder={t("workItems.descriptionPlaceholder")}
                onImageInsert={handleImageInsert}
                minHeight={200}
                maxHeight="100%"
                showTokenCount={false}
                hideHeader
                className="no-bottom-border project-markdown-editor text-[13px]"
              />
            </div>
          </div>
          <div className="shrink-0 px-3 py-2 [&_[data-property-dropdown]]:!bottom-full [&_[data-property-dropdown]]:!top-auto [&_[data-property-dropdown]]:!mb-1 [&_[data-property-dropdown]]:!mt-0">
            <WorkItemProperties
              workItem={stubWorkItem}
              onUpdate={handlePropertyUpdate}
              availableProjects={resolvedProjects}
              availableMilestones={availableMilestones}
              availableLabels={resolvedLabels}
              availableMembers={resolvedMembers}
              availableAgents={customAgents}
              availableOrgs={availableOrgs}
              fieldVariant="pill"
            />
          </div>
        </div>
      }
      footer={
        <>
          <label className="mr-2 flex items-center gap-2 text-[12px] text-text-2">
            <Switch
              size="small"
              checked={createMore}
              onChange={(checked) => setCreateMore(checked)}
            />
            <span>{t("projects.createMore")}</span>
          </label>
          <Button
            variant="primary"
            size="small"
            onClick={handleCreate}
            disabled={!draft.name.trim() || saving}
          >
            {saving ? t("common:status.saving") : t("workItems.createWorkItem")}
          </Button>
        </>
      }
    />
  );
};

export default CreateWorkItemView;
