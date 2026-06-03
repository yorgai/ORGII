/**
 * CreateProjectView Component
 *
 * Project creation form reused by Project Manager modals and embedded create flows.
 * Draft state is cached in a jotai atom keyed by tabId, so callers can preserve
 * unsaved form data while the create surface remains mounted.
 *
 * Handles its own centralized project-store write logic so the layout doesn't need
 * to pass persistence callbacks.
 *
 * Split layout:
 *   - Header: title + close button
 *   - Left: ProjectContentEditor (title, summary, detail description)
 *   - Right: PropertiesPanel
 *   - Footer: Cancel / Create project
 */
import { emit } from "@tauri-apps/api/event";
import { useAtomValue, useSetAtom } from "jotai";
import { X } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { type ProjectOrg, projectApi } from "@src/api/http/project";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import { useKeyboardSave } from "@src/hooks/keyboard";
import { useUndoStackWithRestore } from "@src/hooks/ui";
import {
  DetailSplitLayout,
  type LinkedRepoOption,
  PROJECT_PROPERTY_CONCISE_FIELDS,
  ProjectContentEditor,
  type ProjectContentEditorRef,
  type ProjectData,
  ProjectPropertyFields,
} from "@src/modules/ProjectManager/shared";
import { PANEL_HEADER_TOKENS } from "@src/modules/shared/layouts/blocks";
import { reposAtom } from "@src/store/repo";
import {
  type ProjectDraft,
  createDefaultProjectDraft,
  patchProjectDraftAtom,
  projectDraftsAtom,
  removeProjectDraftAtom,
  setProjectDraftAtom,
} from "@src/store/workstation/projectManager";

// ============================================
// Types
// ============================================

export interface CreateProjectViewProps {
  /** Tab ID used to key the draft cache */
  tabId: string;
  /**
   * Optional repo path the project is being created from. When provided,
   * it's pre-selected in the linked-repos field; the user can still add
   * more or remove it. When omitted, the project starts with no linked
   * repo — fully supported by the backend.
   */
  repoPath?: string;
  /** Repository name used only for linked repo fallback labels. */
  repoName?: string;
  /** Scope label for breadcrumb display. */
  scopeBreadcrumbLabel?: string;
  /** Native ORGII org that owns the created project. */
  orgId: string;
  /** Cancel / discard the draft and close the tab */
  onCancel: () => void;
  /** Mark this tab as having unsaved changes */
  onSetUnsaved: (hasUnsaved: boolean) => void;
  /** Called after project is successfully created */
  onProjectCreated: (options?: { keepOpen?: boolean }) => void;
  /** Publish page header into the global WorkstationTabHeader. */
  publishHeaderToWorkstation?: boolean;
}

// ============================================
// Component
// ============================================

const CreateProjectView: React.FC<CreateProjectViewProps> = ({
  tabId,
  repoPath,
  repoName,
  scopeBreadcrumbLabel,
  orgId,
  onCancel,
  onSetUnsaved,
  onProjectCreated,
  publishHeaderToWorkstation = false,
}) => {
  const { t } = useTranslation("projects");
  const [saving, setSaving] = useState(false);
  const [availableOrgs, setAvailableOrgs] = useState<ProjectOrg[]>([]);

  // Read draft from atom (survives tab switches)
  const draftsMap = useAtomValue(projectDraftsAtom);
  const draft = draftsMap.get(tabId) ?? createDefaultProjectDraft();
  const setDraft = useSetAtom(setProjectDraftAtom);
  const patchDraft = useSetAtom(patchProjectDraftAtom);
  const removeDraft = useSetAtom(removeProjectDraftAtom);

  // Available repos for the linked-repos picker. Sourced from the global
  // repo store so the picker shows every workspace repo the user has — not
  // just the one we entered the project manager from.
  const repos = useAtomValue(reposAtom);
  const availableRepos = useMemo<LinkedRepoOption[]>(
    () =>
      repos
        .map((repo) => ({
          id: repo.path ?? repo.fs_uri ?? repo.id,
          name: repo.name || repo.path || repo.id,
        }))
        .filter((repo) => repo.id),
    [repos]
  );

  // Track whether we've initialised the draft atom for this tab
  const initialisedRef = useRef(false);
  useEffect(() => {
    if (!initialisedRef.current && !draftsMap.has(tabId)) {
      const initial = createDefaultProjectDraft();
      initial.orgId = orgId;
      if (repoPath) initial.linkedRepoPaths = [repoPath];
      setDraft({ tabId, draft: initial });
      initialisedRef.current = true;
    }
  }, [tabId, draftsMap, setDraft, repoPath, orgId]);

  useEffect(() => {
    let cancelled = false;

    const loadOrgs = async () => {
      const orgs = await projectApi.readOrgs();
      if (!cancelled) setAvailableOrgs(orgs);
    };

    void loadOrgs();
    return () => {
      cancelled = true;
    };
  }, []);

  const editorRef = useRef<ProjectContentEditorRef>(null);
  const propertiesRef = useRef<HTMLDivElement>(null);

  const undoStack = useUndoStackWithRestore<ProjectDraft>({
    keyboardShortcut: true,
    currentValue: draft,
    onRestore: (prev) => setDraft({ tabId, draft: prev }),
  });

  // Helpers to persist draft + mark tab dirty
  const updateDraft = useCallback(
    (updates: Partial<ProjectDraft>) => {
      undoStack.snapshot(draft);
      patchDraft({ tabId, patch: updates });
      onSetUnsaved(true);
    },
    [draft, tabId, patchDraft, onSetUnsaved, undoStack]
  );

  // Field handlers
  const handleTitleChange = useCallback(
    (name: string) => updateDraft({ name }),
    [updateDraft]
  );

  const handleSummaryChange = useCallback(
    (summary: string) => updateDraft({ summary }),
    [updateDraft]
  );

  const handleDescriptionChange = useCallback(
    (html: string, _text: string) => updateDraft({ description: html }),
    [updateDraft]
  );

  const handleProjectUpdate = useCallback(
    (updates: Partial<ProjectData>) => {
      const mapped: Partial<ProjectDraft> = {};
      if (updates.status !== undefined) mapped.status = updates.status;
      if (updates.priority !== undefined) mapped.priority = updates.priority;
      if (updates.health !== undefined) mapped.health = updates.health;
      if (updates.lead !== undefined) mapped.leadId = updates.lead?.id;
      if (updates.members !== undefined)
        mapped.memberIds = updates.members?.map((member) => member.id) || [];
      if (updates.teams !== undefined)
        mapped.teamIds = updates.teams?.map((team) => team.id) || [];
      if (updates.labels !== undefined)
        mapped.labelIds = updates.labels?.map((label) => label.id) || [];
      if (updates.linkedRepos !== undefined)
        mapped.linkedRepoPaths =
          updates.linkedRepos?.map((repo) => repo.id) || [];
      if (updates.startDate !== undefined) mapped.startDate = updates.startDate;
      if (updates.targetDate !== undefined)
        mapped.targetDate = updates.targetDate;
      updateDraft(mapped);
    },
    [updateDraft]
  );

  // Build a name lookup for repo paths so `projectData.linkedRepos` shows
  // friendly labels in the picker chip even before the global repo list
  // reloads (e.g. when entered from a repo we've cached but not yet listed).
  const repoNameByPath = useMemo(() => {
    const map = new Map<string, string>();
    for (const repo of availableRepos) map.set(repo.id, repo.name);
    if (repoPath && repoName) map.set(repoPath, repoName);
    return map;
  }, [availableRepos, repoPath, repoName]);

  // Build ProjectData for the PropertiesPanel from the flat draft
  const projectData: ProjectData = {
    id: "",
    name: draft.name,
    status: draft.status as ProjectData["status"],
    priority: draft.priority as ProjectData["priority"],
    health: draft.health as ProjectData["health"],
    lead: draft.leadId ? { id: draft.leadId, name: "" } : undefined,
    members: draft.memberIds.map((id) => ({ id, name: "" })),
    teams: draft.teamIds.map((id) => ({ id, name: "" })),
    labels: draft.labelIds.map((id) => ({ id, name: "", color: "" })),
    linkedRepos: draft.linkedRepoPaths.map((path) => ({
      id: path,
      name: repoNameByPath.get(path) ?? path,
    })),
    startDate: draft.startDate,
    targetDate: draft.targetDate,
  };

  const handleCreate = useCallback(async () => {
    if (!draft.name.trim() || saving) return;

    setSaving(true);
    try {
      const name = draft.name.trim();
      const descriptionText =
        editorRef.current?.getDescriptionText()?.trim() ?? "";
      const parts = [draft.summary.trim(), descriptionText].filter(Boolean);
      const description = parts.join("\n\n");

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const now = new Date().toISOString();
      const workItemPrefix = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      const normalizedWorkItemPrefix = workItemPrefix
        ? workItemPrefix.slice(0, 3).padEnd(3, "X")
        : "PRJ";

      await projectApi.writeProject(
        slug,
        {
          id: `proj-${slug}`,
          name,
          org_id: draft.orgId,
          status: draft.status || "backlog",
          priority: draft.priority || "none",
          health: draft.health || "no_updates",
          lead: draft.leadId,
          members: draft.memberIds,
          labels: draft.labelIds,
          linked_repos: draft.linkedRepoPaths,
          start_date: draft.startDate,
          target_date: draft.targetDate,
          created_at: now,
          updated_at: now,
          next_work_item_id: 1,
          work_item_prefix: normalizedWorkItemPrefix,
          work_item_prefix_custom: false,
        },
        description,
        true
      );

      await emit("orgii-data-changed");
      removeDraft(tabId);
      onProjectCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[CreateProjectView] Failed to create project:", err);
      Message.error(msg);
    } finally {
      setSaving(false);
    }
  }, [draft, onProjectCreated, removeDraft, saving, tabId]);

  useKeyboardSave(handleCreate, !saving && !!draft.name.trim());

  const orgOptions = useMemo<SelectOption[]>(
    () =>
      availableOrgs.map((org) => ({
        value: org.id,
        label: org.name,
        triggerLabel: org.name,
      })),
    [availableOrgs]
  );

  const selectedOrgLabel =
    orgOptions.find((option) => option.value === draft.orgId)?.triggerLabel ??
    scopeBreadcrumbLabel ??
    draft.orgId;

  const handleOrgChange = useCallback(
    (value: string | number | (string | number)[]) => {
      if (Array.isArray(value)) return;
      updateDraft({ orgId: String(value) });
    },
    [updateDraft]
  );

  const orgBreadcrumbPill = (
    <Select
      value={draft.orgId}
      options={orgOptions}
      onChange={handleOrgChange}
      placeholder={selectedOrgLabel}
      size="small"
      radius="pill"
      showSearch
      dropdownWidthMode="min-match"
      dropdownMinWidth={220}
      // CreateProjectView renders inside the Project create Modal (z-index
      // 9999). Without bumping the panel z-index the dropdown gets hidden
      // behind the modal mask and looks like "the dropdown does nothing".
      panelZIndex={10000}
      className="w-auto max-w-[220px] [&_.select-selector]:!h-7 [&_.select-selector]:!rounded-full [&_.select-selector]:!bg-bg-2 [&_.select-selector]:!px-3 [&_.select-selector]:!text-[13px] [&_.select-selector]:!font-medium [&_.select-selector]:!shadow-none"
    />
  );

  const breadcrumb = [orgBreadcrumbPill, t("projects.newProject")];

  return (
    <DetailSplitLayout
      title={t("projects.newProject")}
      breadcrumb={breadcrumb}
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
          <div className="min-h-0 flex-1 px-4 pt-4">
            <ProjectContentEditor
              ref={editorRef}
              title={draft.name}
              onTitleChange={handleTitleChange}
              summary={draft.summary}
              onSummaryChange={handleSummaryChange}
              initialDescription={draft.description || undefined}
              onDescriptionChange={handleDescriptionChange}
              descriptionClassName="no-bottom-border"
              descriptionMaxHeight="100%"
              repoPath={repoPath}
              className="flex h-full min-h-0 flex-col"
              autoFocusTitle
            />
          </div>
          <div
            ref={propertiesRef}
            className="shrink-0 px-3 py-2 [&_[data-property-dropdown]]:!bottom-full [&_[data-property-dropdown]]:!top-auto [&_[data-property-dropdown]]:!mb-1 [&_[data-property-dropdown]]:!mt-0"
          >
            <ProjectPropertyFields
              project={projectData}
              onUpdate={handleProjectUpdate}
              availableRepos={availableRepos}
              containerRef={propertiesRef}
              fieldVariant="pill"
              visibleFields={PROJECT_PROPERTY_CONCISE_FIELDS}
              showMoreMenu
            />
          </div>
        </div>
      }
      footer={
        <Button
          variant="primary"
          size="small"
          onClick={handleCreate}
          disabled={!draft.name.trim() || saving}
        >
          {saving ? t("common:status.saving") : t("projects.createProject")}
        </Button>
      }
    />
  );
};

export default CreateProjectView;
