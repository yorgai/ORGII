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
import { useAtom, useAtomValue } from "jotai";
import { GitPullRequest, Layout, MoreHorizontal } from "lucide-react";
import React, { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import StackPill from "@src/engines/ChatPanel/InputArea/components/StackPill";
import UserActionButton from "@src/engines/ChatPanel/InputArea/components/UserActionButton";
import { useSlashItemsCache } from "@src/engines/ChatPanel/hooks/useInputArea/useSlashItemsCache";
import { EditorTabService } from "@src/services/workStation";
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import {
  type PinnedAction,
  pinnedActionsAtom,
} from "@src/store/session/pinnedActionsAtom";
import {
  workstationPrAtom,
  workstationPrCallbackAtom,
} from "@src/store/workstation/codeEditor/workstationPrAtom";
import { workstationLayoutAtom } from "@src/store/workstation/tabs";
import {
  createCanvasPreviewTab,
  getCanvasPreviewTabId,
} from "@src/store/workstation/tabs/factories/canvasPreview";
import type { SlashItem } from "@src/types/extensions";
import { SLASH_ACTIONS } from "@src/types/extensions";

import { buildMcpToolCommand } from "../SlashCommandPortal/slashItemUtils";
import PinActionsPanel, { actionKey } from "./PinActionsPanel";

const BUILTIN_SLASH_ITEMS: SlashItem[] = [
  {
    name: SLASH_ACTIONS.SETUP_REPO,
    description: "Auto-detect the repo and launch a one-click setup session",
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

    // ── PR pill ───────────────────────────────────────────────────────────────

    const { readyToCreate: prReadyToCreate, isCreating: prIsCreating } =
      useAtomValue(workstationPrAtom);
    const { createPr } = useAtomValue(workstationPrCallbackAtom);

    const handleOpenPr = useCallback(() => {
      if (!createPr || prIsCreating) return;
      void createPr();
    }, [createPr, prIsCreating]);

    const showPrPill = prReadyToCreate && Boolean(createPr);

    // ── Canvas pill ───────────────────────────────────────────────────────────

    const [canvasEntry, setCanvasEntry] = useAtom(canvasPreviewAtom);
    const workstationLayout = useAtomValue(workstationLayoutAtom);

    const showCanvasPill = Boolean(
      sessionId &&
      canvasEntry?.sessionId === sessionId &&
      canvasEntry.cardDismissed
    );

    const isCanvasTabOpen = Boolean(
      sessionId &&
      workstationLayout?.mainPane?.tabs.some(
        (tab) => tab.id === getCanvasPreviewTabId(sessionId)
      )
    );

    const handleOpenCanvas = useCallback(() => {
      if (!sessionId) return;
      const tab = createCanvasPreviewTab(sessionId);
      EditorTabService.openTab(tab);
    }, [sessionId]);

    const handleClearCanvas = useCallback(() => {
      setCanvasEntry(null);
    }, [setCanvasEntry]);

    // ── Built-in "Setup Repo" action ──────────────────────────────────────────

    const handleSetupRepo = useCallback(() => {
      if (!tiptapRef.current) return;
      tiptapRef.current.appendFilePill(
        "/setup-repo",
        false,
        "skill",
        "setup-repo"
      );
      tiptapRef.current.focus();
    }, [tiptapRef]);

    // ── Available items (shared cache) ────────────────────────────────────────

    const {
      filteredItems: availableItems,
      loading: loadingItems,
      fetchFresh,
    } = useSlashItemsCache({ builtinItems: BUILTIN_SLASH_ITEMS });

    // ── "..." panel state ─────────────────────────────────────────────────────

    const [panelOpen, setPanelOpen] = useState(false);
    const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    const handleOpenPanel = useCallback(() => {
      void fetchFresh();
      setAnchorRect(moreButtonRef.current?.getBoundingClientRect() ?? null);
      setPanelOpen((prev) => !prev);
    }, [fetchFresh]);

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
        if (action.category === "action") {
          if (action.name === SLASH_ACTIONS.SETUP_REPO) {
            handleSetupRepo();
            return;
          }
          return;
        }

        if (!tiptapRef.current) return;

        if (action.category === "skill") {
          const skillToken = `/${action.skillName ?? action.name}`;
          tiptapRef.current.appendFilePill(
            skillToken,
            false,
            "skill",
            action.name
          );
          tiptapRef.current.focus();
          return;
        }

        if (action.category === "tool" && action.serverName) {
          tiptapRef.current
            .getEditor()
            ?.chain()
            .focus()
            .insertContent(buildMcpToolCommand(action.serverName, action.name))
            .run();
          return;
        }

        tiptapRef.current
          .getEditor()
          ?.chain()
          .focus()
          .insertContent(`/${action.name} `)
          .run();
      },
      [tiptapRef, handleSetupRepo]
    );

    return (
      <div className="relative flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
        {showPrPill && (
          <StackPill
            icon={<GitPullRequest size={12} strokeWidth={1.75} />}
            count={0}
            active={prIsCreating}
            label={
              prIsCreating
                ? t("input.pr.creating", { defaultValue: "Creating PR…" })
                : t("input.pr.open", { defaultValue: "Open PR" })
            }
            title={t("input.pr.open", { defaultValue: "Open PR" })}
            onClick={handleOpenPr}
          />
        )}

        {showCanvasPill && !isCanvasTabOpen && (
          <UserActionButton
            leftIcon={<Layout size={12} strokeWidth={1.75} />}
            title="Canvas"
            onClick={handleOpenCanvas}
            onClose={handleClearCanvas}
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
