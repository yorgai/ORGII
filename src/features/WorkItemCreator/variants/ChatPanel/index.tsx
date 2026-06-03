import { emit } from "@tauri-apps/api/event";
import { useAtomValue, useSetAtom } from "jotai";
import { ListTodo } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { type WorkItemFrontmatter, projectApi } from "@src/api/http/project";
import Button from "@src/components/Button";
import ComposerInput, {
  type ComposerInputRef,
} from "@src/components/ComposerInput";
import ComposerShell from "@src/components/ComposerShell";
import Message from "@src/components/Message";
import { DETAIL_PANEL_TOKENS } from "@src/config/detailPanelTokens";
import type { RunningLocation } from "@src/config/sessionCreatorConfig";
import { SessionInfoLine } from "@src/features/SessionCreator/components";
import "@src/features/SessionCreator/variants/ChatPanel/index.scss";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import {
  useKeyboardSave,
  useTauriSelectAllShortcut,
} from "@src/hooks/keyboard";
import { createLogger } from "@src/hooks/logger";
import {
  mapWorkItemUpdatesToDraftPatch,
  useWorkItemCreatorDraft,
  workItemDraftToStubWorkItem,
} from "@src/hooks/project";
import { useAgentDefinitions } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentDefinitions";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import WorkItemProperties from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties";
import type { WorkItemPropertyFieldKey } from "@src/modules/ProjectManager/WorkItems/components/WorkItemProperties/types";
import { unresolveImagePathsForStorage } from "@src/modules/ProjectManager/shared/utils/workItemImagePaths";
import { REPO_KIND } from "@src/store/repo/types";
import { runningLocationAtom } from "@src/store/session/runningLocationAtom";
import { selectedWorktreePathAtom } from "@src/store/session/selectedWorktreePathAtom";
import type { Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
  WorkItemProject,
} from "@src/types/core/workItem";

const CHAT_PANEL_WORK_ITEM_FIELDS: WorkItemPropertyFieldKey[] = [
  "project",
  "status",
  "priority",
  "assignee",
  "date",
];

const logger = createLogger("WorkItemCreatorChatPanel");

export interface WorkItemCreatorChatPanelProps {
  centerFullScreenContent?: boolean;
  className?: string;
  variant?: "default" | "fullScreen";
  onWorkItemCreated?: () => void;
}

const WorkItemCreatorChatPanel: React.FC<WorkItemCreatorChatPanelProps> = memo(
  ({
    centerFullScreenContent = false,
    className = "",
    variant = "default",
    onWorkItemCreated,
  }) => {
    const { t } = useTranslation(["projects", "common"]);
    const { agents: customAgents } = useAgentDefinitions();
    const { orgs: availableOrgs } = useAgentOrgs();
    const {
      selectedRepoId,
      selectRepo,
      currentRepo,
      currentBranch,
      loadBranchList,
      selectBranch,
    } = useRepoSelection({ autoLoad: true });
    const runningLocation = useAtomValue(runningLocationAtom);
    const setRunningLocation = useSetAtom(runningLocationAtom);
    const setSelectedWorktreePath = useSetAtom(selectedWorktreePathAtom);
    const editorRef = useRef<ComposerInputRef>(null);
    const [saving, setSaving] = useState(false);
    const [loadedMembers, setLoadedMembers] = useState<Person[]>([]);
    const [loadedProjects, setLoadedProjects] = useState<WorkItemProject[]>([]);
    const [loadedProjectSlugById, setLoadedProjectSlugById] = useState<
      Record<string, string>
    >({});
    const [loadedLabels, setLoadedLabels] = useState<WorkItemLabel[]>([]);

    const defaultProjectId =
      loadedProjects.length > 0 ? loadedProjects[0].id : undefined;
    const { draft, updateDraft, clearDraft } = useWorkItemCreatorDraft({
      defaultProjectId,
    });
    const tauriSelectAll = useTauriSelectAllShortcut();

    useEffect(() => {
      if (!selectedRepoId) return;
      if (currentRepo?.kind === REPO_KIND.FOLDER) return;
      loadBranchList();
    }, [selectedRepoId, loadBranchList, currentRepo?.kind]);

    useEffect(() => {
      let cancelled = false;

      async function loadProjects() {
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
          logger.warn(
            "Failed to load projects for chat-panel work item creator",
            err
          );
        }
      }

      loadProjects();
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      if (!draft.projectId) return;
      const projectSlug = loadedProjectSlugById[draft.projectId];
      if (!projectSlug) return;
      let cancelled = false;

      async function loadProjectLookups() {
        try {
          const [membersFile, labelsFile] = await Promise.all([
            projectApi.readMembers(projectSlug),
            projectApi.readLabels(projectSlug),
          ]);
          if (cancelled) return;
          setLoadedMembers(
            membersFile.members
              .filter((member) => member.active !== false)
              .map((member) => ({
                id: member.id,
                name: member.name,
                email: member.email,
                avatar: member.avatar,
              }))
          );
          setLoadedLabels(
            labelsFile.labels.map((label) => ({
              id: label.id,
              name: label.name,
              color: label.color,
            }))
          );
        } catch (err) {
          logger.warn(
            "Failed to load project metadata for chat-panel creator",
            err
          );
        }
      }

      loadProjectLookups();
      return () => {
        cancelled = true;
      };
    }, [draft.projectId, loadedProjectSlugById]);

    const selectedProjectName =
      loadedProjects.find((project) => project.id === draft.projectId)?.name ??
      "";

    const repoDisplayName = currentRepo?.name;
    const currentRepoPath = currentRepo?.path ?? currentRepo?.fs_uri ?? "";
    const effectiveBranchName = currentBranch || "main";

    const handleWorktreeLocationChange = useCallback(
      (location: RunningLocation) => {
        setSelectedWorktreePath(null);
        setRunningLocation(location);
      },
      [setRunningLocation, setSelectedWorktreePath]
    );

    const handleBranchChange = useCallback(
      (branch: string) => {
        void selectBranch(branch);
      },
      [selectBranch]
    );

    const handlePropertyUpdate = useCallback(
      (updates: Partial<WorkItemExtended>) => {
        updateDraft(mapWorkItemUpdatesToDraftPatch(updates));
      },
      [updateDraft]
    );

    const stubWorkItem = useMemo(
      () => workItemDraftToStubWorkItem(draft, selectedProjectName),
      [draft, selectedProjectName]
    );

    const handleCreate = useCallback(async () => {
      const title = draft.name.trim();
      if (!title || saving) return;
      const projectSlug = draft.projectId
        ? loadedProjectSlugById[draft.projectId]
        : undefined;
      if (draft.projectId && !projectSlug) {
        Message.error(t("projects:properties.noProjectSelected"));
        return;
      }

      setSaving(true);
      try {
        const now = new Date().toISOString();
        const rawDescription =
          editorRef.current?.getHTML()?.trim() ?? draft.description;
        const descriptionText = unresolveImagePathsForStorage(rawDescription);
        const shortId = projectSlug
          ? await projectApi.allocateWorkItemId(projectSlug)
          : await projectApi.allocateStandaloneWorkItemId();
        const frontmatter: WorkItemFrontmatter = {
          id: shortId,
          short_id: shortId,
          title,
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

        if (projectSlug) {
          await projectApi.writeWorkItem(
            projectSlug,
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
        clearDraft();
        editorRef.current?.clear();
        onWorkItemCreated?.();
        Message.success(t("projects:workItems.createWorkItem"));
      } catch (err) {
        logger.error("Failed to create work item from chat-panel creator", err);
        const message = err instanceof Error ? err.message : String(err);
        Message.error(message);
      } finally {
        setSaving(false);
      }
    }, [
      draft,
      loadedProjectSlugById,
      onWorkItemCreated,
      clearDraft,
      saving,
      t,
    ]);

    useKeyboardSave(handleCreate, !saving && Boolean(draft.name.trim()));

    const isFullScreenVariant = variant === "fullScreen";

    return (
      <div className={`session-creator-chat-panel-wrapper ${className}`}>
        <div
          className={`flex min-h-0 flex-1 items-center justify-center ${
            isFullScreenVariant ? "px-4" : "px-5"
          } ${
            isFullScreenVariant
              ? centerFullScreenContent
                ? "pb-[10vh]"
                : "pb-[18vh]"
              : "pb-[10vh]"
          }`}
        >
          <div
            className={`flex w-full flex-col items-stretch gap-3 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
          >
            <div className="session-creator-chat-panel-fullscreen-composer w-full">
              <div
                className={`mx-auto w-full ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
              >
                <ComposerShell
                  variant="embedded"
                  className="wp_text_area session-creator-chat-panel-fullscreen-input-shell relative z-20"
                >
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft({ name: event.target.value })
                    }
                    onKeyDown={tauriSelectAll}
                    placeholder={t("projects:workItems.titlePlaceholder")}
                    className="w-full border-b border-border-2 bg-transparent px-3 pb-1 text-[14px] font-medium text-text-1 outline-none placeholder:text-text-3"
                    autoFocus
                  />
                  <ComposerInput
                    ref={editorRef}
                    initialContent={draft.description}
                    placeholder={t("projects:workItems.descriptionPlaceholder")}
                    onContentChange={() => {
                      const html = editorRef.current?.getHTML() ?? "";
                      updateDraft({ description: html });
                    }}
                    requireCmdEnter
                    onSubmit={handleCreate}
                    className="session-editor flex-1 cursor-text overflow-y-auto rounded-md text-[14px] text-text-1"
                    minHeight={90}
                    maxHeight={220}
                  />
                  <div className="flex min-h-9 w-full items-center justify-end gap-2 px-1 text-text-2">
                    <Button
                      variant="primary"
                      size="small"
                      shape="circle"
                      iconOnly
                      loading={saving}
                      disabled={!draft.name.trim() || saving}
                      onClick={handleCreate}
                      aria-label={t("projects:workItems.createWorkItem")}
                      icon={<ListTodo size={15} strokeWidth={2} />}
                    />
                  </div>
                </ComposerShell>
                <div className="session-creator-chat-panel-fullscreen-repo-row px-1 pb-2 pt-3">
                  <div className="flex w-full justify-center">
                    <div
                      className={`flex w-full flex-wrap items-center justify-start gap-0.5 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
                    >
                      <SessionInfoLine
                        repoId={selectedRepoId}
                        repoName={repoDisplayName}
                        repoPath={currentRepoPath}
                        onRepoChange={selectRepo}
                        repoKind={currentRepo?.kind}
                        branchName={effectiveBranchName}
                        onBranchChange={handleBranchChange}
                        worktreeLocation={runningLocation}
                        onWorktreeLocationChange={handleWorktreeLocationChange}
                        fullWidth
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={`relative z-10 mx-auto w-full px-1 pt-2 ${DETAIL_PANEL_TOKENS.contentMaxWidth}`}
              >
                <WorkItemProperties
                  workItem={stubWorkItem}
                  onUpdate={handlePropertyUpdate}
                  availableProjects={loadedProjects}
                  availableMilestones={[] as WorkItemMilestone[]}
                  availableLabels={loadedLabels}
                  availableMembers={loadedMembers}
                  availableAgents={customAgents}
                  availableOrgs={availableOrgs}
                  fieldVariant="pill"
                  visibleFields={CHAT_PANEL_WORK_ITEM_FIELDS}
                  showMoreMenu
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

WorkItemCreatorChatPanel.displayName = "WorkItemCreatorChatPanel";

export default WorkItemCreatorChatPanel;
