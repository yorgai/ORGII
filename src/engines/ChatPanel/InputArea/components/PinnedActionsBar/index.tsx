/**
 * PinnedActionsBar
 *
 * A horizontal row of pill buttons sitting above the chat input area.
 * Each pill represents a pinned action (skill, tool, or built-in). Clicking
 * a pill dispatches the action into the composer (inserts a skill pill or
 * a slash command). A trailing "..." button opens `PinActionsPanel` to
 * search and manage the pinned set.
 *
 * Design: reuses StackPill so pinned actions match composer section pills:
 * 28px height, rounded-full border, and 13px medium text.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtom, useAtomValue } from "jotai";
import { Layout, MoreHorizontal } from "lucide-react";
import React, { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { rpc } from "@src/api/tauri/rpc";
import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import StackPill from "@src/engines/ChatPanel/InputArea/components/StackPill";
import { createLogger } from "@src/hooks/logger";
import { EditorTabService } from "@src/services/workStation";
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import {
  type PinnedAction,
  pinnedActionsAtom,
} from "@src/store/session/pinnedActionsAtom";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";
import {
  createCanvasPreviewTab,
  getCanvasPreviewTabId,
} from "@src/store/workstation/tabs/factories/canvasPreview";
import type { InstalledSkill, SlashItem } from "@src/types/extensions";
import { SLASH_ACTIONS } from "@src/types/extensions";

import PinActionsPanel, { actionKey } from "./PinActionsPanel";

// ── helpers ───────────────────────────────────────────────────────────────────

const logger = createLogger("PinnedActionsBar");

function resolveSkillGroup(skill: InstalledSkill): string {
  const normalized = skill.path.replace(/\\/g, "/");
  const home = normalized.match(
    /^([/\\]Users\/[^/]+|\/home\/[^/]+|\/root)/
  )?.[1];
  if (home) {
    if (normalized.startsWith(`${home}/.cursor/skills`)) return "Cursor Skills";
    if (normalized.startsWith(`${home}/.orgii/skills`)) return "Global Skills";
  }
  const workspaceMatch = normalized.match(
    /^(.*?)\/(?:\.orgii|\.cursor)\/skills\//
  );
  if (workspaceMatch) {
    const segments = workspaceMatch[1].split("/").filter(Boolean);
    return segments[segments.length - 1] ?? skill.source;
  }
  return skill.source;
}

const BUILTIN_SLASH_ITEMS: SlashItem[] = [
  {
    name: SLASH_ACTIONS.SETUP_REPO,
    description: "Auto-detect the repo and launch a one-click setup session",
    category: "action",
    source: "builtin",
    acceptsArgs: false,
  },
  {
    name: SLASH_ACTIONS.OPEN_BROWSER,
    description: "Open browser automation controls",
    category: "action",
    source: "builtin",
    acceptsArgs: false,
  },
];

// ── sub-components ────────────────────────────────────────────────────────────

interface ActionPillProps {
  action: PinnedAction;
  onClick: (action: PinnedAction, e?: React.MouseEvent) => void;
  /** Forward a ref onto the underlying button. */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

const ActionPill: React.FC<ActionPillProps> = memo(
  ({ action, onClick, buttonRef }) => {
    const [pressed, setPressed] = useState(false);

    return (
      <StackPill
        ref={buttonRef}
        count={0}
        active={pressed}
        title={action.name}
        onClick={() => onClick(action)}
        label={action.name}
        className="max-w-[180px] select-none [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
      />
    );
  }
);

ActionPill.displayName = "ActionPill";

// ── main component ────────────────────────────────────────────────────────────

export interface PinnedActionsBarProps {
  /** Ref to the tiptap editor, used to insert content when a pill is clicked. */
  tiptapRef: React.RefObject<TiptapInputRef>;
  /**
   * Active session ID — when provided, a Canvas pill appears whenever the
   * session has a live canvas payload and the canvas tab is not already open.
   */
  sessionId?: string | null;
}

const PinnedActionsBar: React.FC<PinnedActionsBarProps> = memo(
  ({ tiptapRef, sessionId }) => {
    const { t } = useTranslation("sessions");
    const [pinnedActions, setPinnedActions] = useAtom(pinnedActionsAtom);

    // ── Canvas pill ───────────────────────────────────────────────────────────

    const canvasEntry = useAtomValue(canvasPreviewAtom);
    const workstationLayout = useAtomValue(workstationLayoutAtom);

    const hasCanvasPayload = Boolean(
      sessionId && canvasEntry?.sessionId === sessionId
    );

    const isCanvasTabOpen = Boolean(
      sessionId &&
      workstationLayout?.mainPane?.tabs.some(
        (tab) => tab.id === getCanvasPreviewTabId(sessionId)
      )
    );

    const showCanvasPill = hasCanvasPayload && !isCanvasTabOpen;

    const handleOpenCanvas = useCallback(() => {
      if (!sessionId) return;
      const tab = createCanvasPreviewTab(sessionId);
      EditorTabService.openTab(tab);
    }, [sessionId]);

    // ── Built-in "Setup Repo" action ──────────────────────────────────────────

    const handleSetupRepo = useCallback(() => {
      if (!tiptapRef.current) return;
      tiptapRef.current.clear();
      tiptapRef.current.insertFilePill(
        "/setup-repo",
        false,
        "skill",
        "setup-repo"
      );
      tiptapRef.current.focus();
    }, [tiptapRef]);

    // ── Available items (lazy-fetched) ────────────────────────────────────────

    const [availableItems, setAvailableItems] = useState<SlashItem[]>([]);
    const [loadingItems, setLoadingItems] = useState(false);
    const itemsCacheRef = useRef<SlashItem[]>([]);

    const fetchItems = useCallback(async () => {
      if (itemsCacheRef.current.length > 0) {
        setAvailableItems(itemsCacheRef.current);
        return;
      }
      setLoadingItems(true);
      try {
        const [rawSkills, mcpServers] = await Promise.all([
          invoke<InstalledSkill[]>("skills_list", {
            workspacePath: null,
          }).catch((err) => {
            logger.warn("Failed to list skills:", err);
            return [] as InstalledSkill[];
          }),
          rpc.mcp.listServers({}).catch((err) => {
            logger.warn("Failed to list MCP servers:", err);
            return [];
          }),
        ]);

        const skillItems: SlashItem[] = rawSkills
          .filter((s) => s.enabled && s.available)
          .map((s) => ({
            name: s.name,
            skillName: s.name,
            description:
              s.description && s.description !== "---" ? s.description : "",
            category: "skill" as const,
            source: resolveSkillGroup(s),
            acceptsArgs: false,
          }));

        const connectedServers = mcpServers.filter(
          (srv) => srv.status === "connected" && !srv.disabled
        );
        const toolItems: SlashItem[] = (
          await Promise.all(
            connectedServers.map((srv) =>
              rpc.mcp.listServerTools({ serverName: srv.name }).then(
                (tools) =>
                  tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    category: "tool" as const,
                    source: srv.name,
                    acceptsArgs: true,
                    serverName: srv.name,
                  })),
                (err) => {
                  logger.warn(`Failed to list tools for "${srv.name}":`, err);
                  return [] as SlashItem[];
                }
              )
            )
          )
        ).flat();

        const all: SlashItem[] = [
          ...BUILTIN_SLASH_ITEMS,
          ...skillItems,
          ...toolItems,
        ];
        itemsCacheRef.current = all;
        setAvailableItems(all);
      } finally {
        setLoadingItems(false);
      }
    }, []);

    // ── "..." panel state ─────────────────────────────────────────────────────

    const [panelOpen, setPanelOpen] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    const handleOpenPanel = useCallback(() => {
      void fetchItems();
      setAnchorRect(moreButtonRef.current?.getBoundingClientRect() ?? null);
      setPanelOpen((prev) => !prev);
    }, [fetchItems]);

    const handleClosePanel = useCallback(() => {
      setPanelOpen(false);
    }, []);

    // ── Pin / unpin ───────────────────────────────────────────────────────────

    const handleTogglePin = useCallback(
      (action: PinnedAction) => {
        setPinnedActions((prev) => {
          const key = actionKey(action);
          const exists = prev.some((a) => actionKey(a) === key);
          return exists
            ? prev.filter((a) => actionKey(a) !== key)
            : [...prev, action];
        });
      },
      [setPinnedActions]
    );

    // ── Pill click → dispatch ─────────────────────────────────────────────────

    const handlePillClick = useCallback(
      (action: PinnedAction, _e?: React.MouseEvent) => {
        // Built-in actions execute real work and don't require the editor.
        if (action.category === "action") {
          if (action.name === SLASH_ACTIONS.SETUP_REPO) {
            handleSetupRepo();
            return;
          }
          if (action.name === SLASH_ACTIONS.OPEN_BROWSER) {
            window.dispatchEvent(new CustomEvent("orgii:open-browser"));
          }
          return;
        }

        if (!tiptapRef.current) return;

        if (action.category === "skill") {
          const skillToken = `/${action.skillName ?? action.name}`;
          tiptapRef.current.clear();
          tiptapRef.current.insertFilePill(
            skillToken,
            false,
            "skill",
            action.name
          );
          tiptapRef.current.focus();
          return;
        }

        if (action.category === "tool" && action.serverName) {
          const serverSlug = action.serverName.replace(/-/g, "_");
          tiptapRef.current.setContent(`/mcp__${serverSlug}__${action.name} `);
          tiptapRef.current.focus();
          return;
        }

        tiptapRef.current.setContent(`/${action.name} `);
        tiptapRef.current.focus();
      },
      [tiptapRef, handleSetupRepo]
    );

    // ── Nothing pinned — still render the "..." button ────────────────────────

    return (
      <div className="relative flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
        {/* Canvas pill — shown when a live canvas exists and its tab is closed */}
        {showCanvasPill && (
          <StackPill
            icon={<Layout size={12} strokeWidth={1.75} />}
            count={0}
            active={false}
            label="Canvas"
            title="Open canvas in WorkStation"
            onClick={handleOpenCanvas}
            className="select-none"
          />
        )}

        {pinnedActions.map((action) => (
          <ActionPill
            key={actionKey(action)}
            action={action}
            onClick={handlePillClick}
          />
        ))}

        <StackPill
          ref={moreButtonRef}
          icon={<MoreHorizontal size={13} strokeWidth={1.75} />}
          count={0}
          active={panelOpen}
          iconOnly
          title={t("input.pinnedActions.manage")}
          ariaLabel={t("input.pinnedActions.manage")}
          onClick={handleOpenPanel}
        />

        <PinActionsPanel
          visible={panelOpen}
          anchorRect={anchorRect}
          availableItems={availableItems}
          pinnedActions={pinnedActions}
          onTogglePin={handleTogglePin}
          onClose={handleClosePanel}
          loading={loadingItems}
          triggerRef={moreButtonRef}
        />
      </div>
    );
  }
);

PinnedActionsBar.displayName = "PinnedActionsBar";

export default PinnedActionsBar;
