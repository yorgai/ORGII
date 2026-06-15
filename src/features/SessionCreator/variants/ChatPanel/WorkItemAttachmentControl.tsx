import { emit } from "@tauri-apps/api/event";
import { Link2, ListTodo, Search, SquarePen, X } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { projectApi } from "@src/api/http/project";
import Button from "@src/components/Button";
import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import { SURFACE_TOKENS } from "@src/config/surfaceTokens";
import type { SessionLaunchWorkItemContext } from "@src/engines/SessionCore/hooks/session/useSessionCreator/useSessionLaunch/types";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { createLogger } from "@src/hooks/logger";
import {
  InlineCreateWorkItemFields,
  useInlineCreateWorkItemFields,
} from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView/InlineCreateWorkItemFields";
import {
  type CreatedWorkItemResult,
  createWorkItemFromDraft,
} from "@src/modules/ProjectManager/WorkItems/components/CreateWorkItemView/createWorkItemFromDraft";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";

const logger = createLogger("WorkItemAttachmentControl");
const WORK_ITEM_SEARCH_RESULT_LIMIT = 8;

type WorkItemAttachmentMode = "create" | "link" | null;

interface ExistingWorkItemOption {
  shortId: string;
  projectSlug?: string;
  title: string;
}

export interface WorkItemAttachmentControlProps {
  onDraftChange?: (draft: WorkItemDraft | null) => void;
  currentWorkItemContext?: SessionLaunchWorkItemContext | null;
  onCreated?: (result?: CreatedWorkItemResult) => void;
  onWorkItemContextChange?: (
    context: SessionLaunchWorkItemContext | null
  ) => void;
  repoPath?: string | null;
}

const WorkItemAttachmentControl: React.FC<WorkItemAttachmentControlProps> = ({
  currentWorkItemContext,
  onDraftChange,
  onCreated,
  onWorkItemContextChange,
  repoPath,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const [mode, setMode] = useState<WorkItemAttachmentMode>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [workItems, setWorkItems] = useState<ExistingWorkItemOption[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const {
    isOpen,
    isPositioned,
    panelPosition,
    triggerRef,
    panelRef,
    toggle,
    close,
  } = useDropdownEngine<HTMLButtonElement>({ placement: "top" });

  const handleDraftChange = useCallback(
    (draft: WorkItemDraft) => {
      onDraftChange?.(draft);
    },
    [onDraftChange]
  );

  const inlineFields = useInlineCreateWorkItemFields({
    onDraftChange: handleDraftChange,
    onSetUnsaved: () => undefined,
    propertiesOpen: false,
    repoPath,
  });

  const loadExistingWorkItems = useCallback(async () => {
    setLoadingSearch(true);
    try {
      const [projects, standaloneItems] = await Promise.all([
        projectApi.readProjects(),
        projectApi.readStandaloneWorkItems(),
      ]);
      const projectItemGroups = await Promise.all(
        projects.map(async (project) => {
          const items = await projectApi.readWorkItems(project.slug);
          return items.map((item) => ({ item, projectSlug: project.slug }));
        })
      );
      const allItems = [
        ...standaloneItems.map((item) => ({ item, projectSlug: undefined })),
        ...projectItemGroups.flat(),
      ];
      setWorkItems(
        allItems.map(({ item, projectSlug }) => ({
          shortId: item.frontmatter.short_id || item.frontmatter.id,
          projectSlug,
          title: item.frontmatter.title,
        }))
      );
    } catch (err) {
      logger.error("Failed to load work items for linking", err);
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSearch(false);
    }
  }, []);

  const handleSelectMode = useCallback(
    (nextMode: WorkItemAttachmentMode) => {
      setMode(nextMode);
      close();
      if (nextMode === "link") {
        void loadExistingWorkItems();
      }
    },
    [close, loadExistingWorkItems]
  );

  const handleClosePanel = useCallback(() => {
    setMode(null);
    setSearchQuery("");
  }, []);

  const handleCreate = useCallback(async () => {
    if (!inlineFields.draft.name.trim() || saving) return;

    setSaving(true);
    try {
      const rawMarkdown =
        inlineFields.editorRef.current?.getMarkdown()?.trim() ??
        inlineFields.draft.description;
      const result = await createWorkItemFromDraft({
        description: rawMarkdown,
        draft: inlineFields.draft,
        selectedProjectSlug: inlineFields.selectedProjectSlug,
      });
      await emit("orgii-data-changed");
      inlineFields.clearDraft();
      onDraftChange?.(null);
      onCreated?.(result);
      onWorkItemContextChange?.({
        workItemId: result.shortId,
        projectSlug: result.projectSlug,
        agentRole: "custom",
      });
      setMode(null);
    } catch (err) {
      logger.error("Failed to create work item from composer", err);
      Message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [inlineFields, onCreated, onDraftChange, onWorkItemContextChange, saving]);

  const filteredWorkItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? workItems.filter(
          (item) =>
            item.title.toLowerCase().includes(query) ||
            item.shortId.toLowerCase().includes(query)
        )
      : workItems;
    return filtered.slice(0, WORK_ITEM_SEARCH_RESULT_LIMIT);
  }, [searchQuery, workItems]);

  const handleLinkWorkItem = useCallback(
    (item: ExistingWorkItemOption) => {
      onWorkItemContextChange?.({
        workItemId: item.shortId,
        projectSlug: item.projectSlug,
        agentRole: "custom",
      });
      Message.success(item.title);
      setMode(null);
      setSearchQuery("");
    },
    [onWorkItemContextChange]
  );

  const handleRemoveWorkItem = useCallback(() => {
    onWorkItemContextChange?.(null);
    close();
  }, [close, onWorkItemContextChange]);

  const triggerActive =
    isOpen || mode !== null || Boolean(currentWorkItemContext);

  return (
    <div className="relative flex shrink-0 flex-col items-start">
      <div className="relative shrink-0">
        <Button
          ref={triggerRef}
          variant="secondary"
          appearance="outline"
          size="small"
          shape="round"
          icon={<ListTodo size={14} strokeWidth={1.75} />}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          onClick={toggle}
          className={
            triggerActive ? "shrink-0 !bg-fill-1 !text-primary-6" : "shrink-0"
          }
          data-testid="session-creator-work-item-toggle"
        >
          {t("projects:workItems.addWorkItem")}
        </Button>

        {isOpen &&
          isPositioned &&
          createPortal(
            <div
              ref={panelRef}
              className={`${DROPDOWN_CLASSES.menuPanelBase} fixed ${DROPDOWN_WIDTHS.menuClass}`}
              style={{
                ...(panelPosition.top !== undefined
                  ? { top: panelPosition.top }
                  : { bottom: panelPosition.bottom }),
                left: panelPosition.left,
              }}
              role="menu"
            >
              {currentWorkItemContext ? (
                <button
                  type="button"
                  className={DROPDOWN_CLASSES.menuActionItem}
                  role="menuitem"
                  onClick={handleRemoveWorkItem}
                >
                  <X
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                    className="text-text-2"
                  />
                  <span>{t("common:actions.remove")}</span>
                  <span className="ml-auto text-[11px] text-text-3">
                    {currentWorkItemContext.workItemId}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                className={DROPDOWN_CLASSES.menuActionItem}
                role="menuitem"
                onClick={() => handleSelectMode("link")}
              >
                <Link2
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                  className="text-text-2"
                />
                <span>{t("common:actions.link")}</span>
              </button>
              <button
                type="button"
                className={DROPDOWN_CLASSES.menuActionItem}
                role="menuitem"
                onClick={() => handleSelectMode("create")}
              >
                <SquarePen
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                  className="text-text-2"
                />
                <span>{t("common:actions.create")}</span>
              </button>
            </div>,
            document.body
          )}
      </div>

      {mode === "create" ? (
        <div
          className={`mt-1 flex w-[520px] flex-col rounded-[12px] border border-solid border-border-2 ${SURFACE_TOKENS.surface} p-3`}
          data-testid="work-item-create-inline-panel"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] font-medium text-text-1">
              <SquarePen size={14} strokeWidth={1.75} className="text-text-2" />
              <span>{t("common:actions.create")}</span>
            </div>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              icon={<X size={14} strokeWidth={1.75} />}
              onClick={handleClosePanel}
              aria-label={t("common:actions.close")}
            />
          </div>
          <InlineCreateWorkItemFields
            state={inlineFields}
            className="max-h-[180px] w-full"
            descriptionClassName="hidden"
            showDescription={false}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="secondary" size="small" onClick={handleClosePanel}>
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleCreate}
              disabled={!inlineFields.draft.name.trim() || saving}
            >
              {saving ? t("common:status.saving") : t("common:actions.create")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "link" ? (
        <div
          className={`mt-1 flex w-[420px] flex-col rounded-[12px] border border-solid border-border-2 ${SURFACE_TOKENS.surface}`}
          data-testid="work-item-link-inline-panel"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border-2 px-3 py-2">
            <div className="flex items-center gap-2 text-[12px] font-medium text-text-1">
              <Link2 size={14} strokeWidth={1.75} className="text-text-2" />
              <span>{t("common:actions.link")}</span>
            </div>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              icon={<X size={14} strokeWidth={1.75} />}
              onClick={handleClosePanel}
              aria-label={t("common:actions.close")}
            />
          </div>
          <DropdownSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={t("projects:workItems.searchPlaceholder")}
            autoFocus
          />
          <div className="max-h-[180px] overflow-y-auto p-1 scrollbar-hide">
            {loadingSearch ? (
              <div className="flex h-16 items-center justify-center text-[12px] text-text-3">
                {t("common:status.loading")}
              </div>
            ) : filteredWorkItems.length > 0 ? (
              filteredWorkItems.map((item) => (
                <button
                  key={`${item.projectSlug ?? "standalone"}:${item.shortId}`}
                  type="button"
                  className={`${DROPDOWN_CLASSES.menuActionItem} w-full justify-start`}
                  onClick={() => handleLinkWorkItem(item)}
                >
                  <Search
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                    className="text-text-2"
                  />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-3">
                    {item.shortId}
                  </span>
                </button>
              ))
            ) : (
              <div className="flex h-16 items-center justify-center text-[12px] text-text-3">
                {t("projects:workItems.noResults")}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default WorkItemAttachmentControl;
