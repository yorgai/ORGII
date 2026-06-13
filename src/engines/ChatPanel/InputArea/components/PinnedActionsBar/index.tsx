/**
 * PinnedActionsBar
 *
 * A horizontal row of pill buttons sitting above the chat input area.
 * Each pill represents a pinned action (skill, tool, or built-in). Clicking
 * a pill dispatches the action into the composer (inserts a skill pill or
 * a slash command). A trailing "..." button opens `PinActionsPanel` to
 * search and manage the pinned set.
 *
 * Design: uses shared secondary buttons so pinned actions match other composer controls.
 */
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  GitCommit,
  GitPullRequest,
  Layout,
  MoreHorizontal,
} from "lucide-react";
import React, { memo, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import type { ComposerInputRef } from "@src/components/ComposerInput";
import UserActionButton from "@src/engines/ChatPanel/InputArea/components/UserActionButton";
import { useSlashItemsCache } from "@src/engines/ChatPanel/hooks/useInputArea/useSlashItemsCache";
import { useMessageDispatch } from "@src/engines/ChatPanel/hooks/useWorkspaceChat/useMessageDispatch";
import { mintTurnIntentId } from "@src/engines/SessionCore/sync/adapters/shared/eventFactories";
import { EditorTabService } from "@src/services/workStation";
import { canvasPreviewAtom } from "@src/store/session/canvasPreviewAtom";
import {
  isSessionActiveAtom,
  setSessionRuntimeStatusAtom,
} from "@src/store/session/cliSessionStatusAtom";
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
  ({ action, onClick, buttonRef }) => (
    <Button
      ref={buttonRef}
      variant="secondary"
      size="small"
      shape="round"
      title={action.name}
      onClick={(event) => onClick(action, event)}
      className="max-w-[180px] shrink-0 select-none"
    >
      {action.name}
    </Button>
  )
);

ActionPill.displayName = "ActionPill";

// ── main component ────────────────────────────────────────────────────────────

export interface PinnedActionsBarProps {
  /** Ref to the tiptap editor, used to insert content when a pill is clicked. */
  composerInputRef: React.RefObject<ComposerInputRef | null>;
  /**
   * Active session ID — when provided, a Canvas pill appears whenever the
   * session has a live canvas payload and the canvas tab is not already open.
   */
  sessionId?: string | null;
  leadingContent?: React.ReactNode;
  manageButtonPlacement?: "after-actions" | "after-leading";
  managePanelAlign?: "left" | "right";
}

const PinnedActionsBar: React.FC<PinnedActionsBarProps> = memo(
  ({
    composerInputRef,
    sessionId,
    leadingContent,
    manageButtonPlacement = "after-actions",
    managePanelAlign = "right",
  }) => {
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

    // ── Commit & Push pill ────────────────────────────────────────────────────

    const isSessionActive = useAtomValue(isSessionActiveAtom);
    const setSessionRuntimeStatus = useSetAtom(setSessionRuntimeStatusAtom);
    const { addUserMessage, dispatchMessageBySessionType } = useMessageDispatch(
      {
        getSessionId: () => sessionId ?? null,
      }
    );
    const commitPushPendingRef = useRef(false);

    const showCommitPushPill = Boolean(sessionId);

    const handleCommitAndPush = useCallback(() => {
      if (!sessionId || isSessionActive || commitPushPendingRef.current) return;
      commitPushPendingRef.current = true;
      const prompt = "Commit all current changes and push to the remote.";
      setSessionRuntimeStatus({
        sessionId,
        status: "running",
        source: "interactive-event",
      });
      void (async () => {
        try {
          const turnIntentId = mintTurnIntentId();
          await addUserMessage(prompt, undefined, turnIntentId);
          await dispatchMessageBySessionType(
            sessionId,
            prompt,
            undefined,
            undefined,
            undefined,
            undefined,
            turnIntentId
          );
        } catch (err) {
          console.error("[PinnedActionsBar] commit & push failed:", err);
        } finally {
          commitPushPendingRef.current = false;
        }
      })();
    }, [
      sessionId,
      isSessionActive,
      addUserMessage,
      dispatchMessageBySessionType,
      setSessionRuntimeStatus,
    ]);

    // ── Built-in "Setup Repo" action ──────────────────────────────────────────

    const handleSetupRepo = useCallback(() => {
      if (!composerInputRef.current) return;
      composerInputRef.current.insertFilePill(
        "/setup-repo",
        false,
        "skill",
        "setup-repo"
      );
      composerInputRef.current.focus();
    }, [composerInputRef]);

    // ── Available items (shared cache) ────────────────────────────────────────

    const {
      filteredItems: availableItems,
      loading: loadingItems,
      fetchFresh,
    } = useSlashItemsCache({ builtinItems: BUILTIN_SLASH_ITEMS });

    // ── "..." panel state ─────────────────────────────────────────────────────

    const [panelOpen, setPanelOpen] = useState(false);
    const moreButtonRef = useRef<HTMLButtonElement>(null);

    const handleOpenPanel = useCallback(() => {
      void fetchFresh();
      setPanelOpen((prev) => !prev);
    }, [fetchFresh]);

    const handleClosePanel = useCallback(() => {
      setPanelOpen(false);
    }, []);

    const hasPinnedActions = pinnedActions.length > 0;
    const showCanvasAction = showCanvasPill && !isCanvasTabOpen;
    const hasActionPills =
      showPrPill || showCommitPushPill || showCanvasAction || hasPinnedActions;

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

    const handleUnpinAll = useCallback(() => {
      setPinnedActions([]);
    }, [setPinnedActions]);

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

        if (!composerInputRef.current) return;

        if (action.category === "skill") {
          const skillToken = `/${action.skillName ?? action.name}`;
          composerInputRef.current.insertFilePill(
            skillToken,
            false,
            "skill",
            action.name
          );
          composerInputRef.current.focus();
          return;
        }

        if (action.category === "tool" && action.serverName) {
          composerInputRef.current
            .getEditor()
            ?.chain()
            .focus()
            .insertContent(buildMcpToolCommand(action.serverName, action.name))
            .run();
          return;
        }

        composerInputRef.current
          .getEditor()
          ?.chain()
          .focus()
          .insertContent(`/${action.name} `)
          .run();
      },
      [composerInputRef, handleSetupRepo]
    );

    const manageButton = (
      <Button
        ref={moreButtonRef}
        variant="secondary"
        appearance="outline"
        size="small"
        shape="round"
        icon={<MoreHorizontal size={14} strokeWidth={1.75} />}
        iconOnly
        title={t("input.pinnedActions.manage")}
        aria-label={t("input.pinnedActions.manage")}
        onClick={handleOpenPanel}
        className={
          panelOpen ? "shrink-0 !bg-fill-1 !text-primary-6" : "shrink-0"
        }
      />
    );

    const actionPills = (
      <>
        {showPrPill && (
          <Button
            variant="secondary"
            size="small"
            shape="round"
            title={t("input.pr.open", { defaultValue: "Open PR" })}
            onClick={handleOpenPr}
            loading={prIsCreating}
            icon={
              !prIsCreating ? (
                <GitPullRequest size={12} strokeWidth={1.75} />
              ) : undefined
            }
            className="max-w-[180px] shrink-0 select-none"
          >
            {prIsCreating
              ? t("input.pr.creating", { defaultValue: "Creating PR…" })
              : t("input.pr.open", { defaultValue: "Open PR" })}
          </Button>
        )}

        {showCommitPushPill && (
          <Button
            variant="secondary"
            size="small"
            shape="round"
            title={t("input.commitPush.run", {
              defaultValue: "Commit & Push",
            })}
            onClick={handleCommitAndPush}
            disabled={isSessionActive}
            icon={<GitCommit size={12} strokeWidth={1.75} />}
            className="max-w-[180px] shrink-0 select-none"
          >
            {t("input.commitPush.run", { defaultValue: "Commit & Push" })}
          </Button>
        )}

        {showCanvasAction && (
          <div className="shrink-0">
            <UserActionButton
              leftIcon={<Layout size={12} strokeWidth={1.75} />}
              title="Canvas"
              onClick={handleOpenCanvas}
              onClose={handleClearCanvas}
            />
          </div>
        )}

        {pinnedActions.map((action) => (
          <ActionPill
            key={actionKey(action)}
            action={action}
            onClick={handlePillClick}
          />
        ))}
      </>
    );

    return (
      <div className="relative flex min-w-0 flex-1 items-center gap-1">
        {manageButtonPlacement === "after-leading" ? (
          <>
            <div className="flex shrink-0 items-center gap-1">
              {leadingContent}
              {manageButton}
            </div>
            {hasActionPills && (
              <div aria-hidden className="mx-2 h-4 w-px shrink-0 bg-border-2" />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 scrollbar-hide">
              {actionPills}
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5 scrollbar-hide">
              {leadingContent}
              {actionPills}
            </div>
            {hasActionPills && (
              <div aria-hidden className="mx-2 h-4 w-px shrink-0 bg-border-2" />
            )}
            {manageButton}
          </>
        )}

        <PinActionsPanel
          visible={panelOpen}
          availableItems={availableItems}
          pinnedActions={pinnedActions}
          onTogglePin={handleTogglePin}
          onInsert={handlePillClick}
          onUnpinAll={handleUnpinAll}
          onClose={handleClosePanel}
          loading={loadingItems}
          triggerRef={moreButtonRef}
          align={managePanelAlign}
        />
      </div>
    );
  }
);

PinnedActionsBar.displayName = "PinnedActionsBar";

export default PinnedActionsBar;
