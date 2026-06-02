/**
 * PinnedActionsBar
 *
 * A horizontal row of pill buttons sitting above the chat input area.
 * Each pill represents a pinned action (skill, tool, or built-in). Clicking
 * a pill dispatches the action into the composer (inserts a skill pill or
 * a slash command). A trailing "..." button opens `PinActionsPanel` to
 * search and manage the pinned set.
 *
 * Design: h-[28px] pills, border-border-2 stroke, rounded-full, text-[12px],
 * accent-highlight on active state — matches StackPill and ModePill idioms.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtom, useAtomValue } from "jotai";
import { Loader2, MoreHorizontal } from "lucide-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import Message from "@src/components/Toast";
import { createLogger } from "@src/hooks/logger";
import { useValidatedLastPair } from "@src/hooks/models/useValidatedLastPair";
import { useRepoDetection } from "@src/modules/WorkStation/Launchpad/hooks/useRepoDetection";
import { useRepoSetup } from "@src/modules/WorkStation/Launchpad/hooks/useRepoSetup";
import { reposAtom } from "@src/store/repo";
import {
  type PinnedAction,
  pinnedActionsAtom,
} from "@src/store/session/pinnedActionsAtom";
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
  onClick: (action: PinnedAction, e: React.MouseEvent) => void;
  /** Shows a spinner and blocks clicks (e.g. while a setup session launches). */
  busy?: boolean;
  /** Forward a ref onto the underlying button (e.g. for the Setup Repo picker). */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

const ActionPill: React.FC<ActionPillProps> = memo(
  ({ action, onClick, busy = false, buttonRef }) => {
    const [pressed, setPressed] = useState(false);

    return (
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
        onClick={(e) => onClick(action, e)}
        className={[
          "flex h-[26px] shrink-0 select-none items-center gap-1 rounded-full border border-solid px-2.5 leading-none",
          "text-[12px] font-medium transition-colors duration-150",
          busy
            ? "cursor-default border-border-2 bg-bg-2 text-text-3"
            : pressed
              ? "cursor-pointer border-primary-5 bg-fill-2 text-primary-6"
              : "cursor-pointer border-border-2 bg-bg-2 text-text-2 hover:border-border-3 hover:bg-fill-2 hover:text-text-1",
        ].join(" ")}
        title={action.name}
      >
        {busy && <Loader2 size={12} className="shrink-0 animate-spin" />}
        <span className="truncate" style={{ maxWidth: 120 }}>
          {action.name}
        </span>
      </button>
    );
  }
);

ActionPill.displayName = "ActionPill";

// ── main component ────────────────────────────────────────────────────────────

export interface PinnedActionsBarProps {
  /** Ref to the tiptap editor, used to insert content when a pill is clicked. */
  tiptapRef: React.RefObject<TiptapInputRef>;
  /**
   * Repo path of the active session / workspace. Used to drive the built-in
   * "Setup Repo" action so a click launches a one-click setup session against
   * the current repo (mirrors LaunchpadActionStrip's Setup button).
   */
  repoPath?: string;
}

const PinnedActionsBar: React.FC<PinnedActionsBarProps> = memo(
  ({ tiptapRef, repoPath }) => {
    const [pinnedActions, setPinnedActions] = useAtom(pinnedActionsAtom);

    // ── Built-in "Setup Repo" action wiring ───────────────────────────────────
    const { launching, launchSetup } = useRepoSetup();
    const lastModel = useValidatedLastPair();
    const repos = useAtomValue(reposAtom);

    // Repo picker state — shown when Setup Repo is clicked without a repoPath
    const [repoPicker, setRepoPicker] = useState(false);
    const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null);
    const setupPillRef = useRef<HTMLButtonElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);

    // Close picker on outside click or Escape.
    useEffect(() => {
      if (!repoPicker) return;
      const handleMouseDown = (e: MouseEvent) => {
        const target = e.target as Node;
        if (
          !setupPillRef.current?.contains(target) &&
          !pickerRef.current?.contains(target)
        ) {
          setRepoPicker(false);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setRepoPicker(false);
        }
      };
      document.addEventListener("mousedown", handleMouseDown);
      document.addEventListener("keydown", handleKeyDown, true);
      return () => {
        document.removeEventListener("mousedown", handleMouseDown);
        document.removeEventListener("keydown", handleKeyDown, true);
      };
    }, [repoPicker]);

    const [setupRepoPath, setSetupRepoPath] = useState<string | undefined>(
      repoPath
    );
    useEffect(() => {
      setSetupRepoPath(repoPath);
    }, [repoPath]);

    const { repoType, repoTypeLabel, configFiles, hasDocker, hasMakefile } =
      useRepoDetection(setupRepoPath || undefined);

    const doLaunchSetup = useCallback(
      async (targetPath: string) => {
        if (launching) return;
        const repoName = targetPath.split("/").filter(Boolean).pop() || "Repo";
        try {
          await launchSetup(
            {
              repoPath: targetPath,
              repoName,
              repoType,
              repoTypeLabel,
              configFiles,
              hasDocker,
              hasMakefile,
            },
            {
              trusted: false,
              keySource: lastModel?.keySource,
              model: lastModel?.model,
              accountId: lastModel?.selectedAccountId,
              cliAgentType: lastModel?.cliAgentType,
              listingModel: lastModel?.listingModel,
              listingModelType: lastModel?.listingModelType,
              tier: lastModel?.tier,
            }
          );
        } catch (error) {
          logger.error("Failed to launch repo setup:", error);
          Message.error("Failed to start repo setup");
        }
      },
      [
        launching,
        repoType,
        repoTypeLabel,
        configFiles,
        hasDocker,
        hasMakefile,
        launchSetup,
        lastModel,
      ]
    );

    const handleSetupRepo = useCallback(
      (e?: React.MouseEvent) => {
        if (launching) return;
        if (setupRepoPath) {
          void doLaunchSetup(setupRepoPath);
          return;
        }
        // No repo associated — show picker
        const btn = setupPillRef.current;
        setPickerAnchor(btn?.getBoundingClientRect() ?? null);
        setRepoPicker((v) => !v);
        e?.stopPropagation();
      },
      [launching, setupRepoPath, doLaunchSetup]
    );

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
      (action: PinnedAction, e?: React.MouseEvent) => {
        // Built-in actions execute real work and don't require the editor.
        if (action.category === "action") {
          if (action.name === SLASH_ACTIONS.SETUP_REPO) {
            handleSetupRepo(e);
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
      <div className="relative z-10 flex w-full items-center gap-1.5 overflow-x-auto px-0.5 py-0.5 scrollbar-hide">
        {pinnedActions.map((action) => {
          const isSetupRepo =
            action.category === "action" &&
            action.name === SLASH_ACTIONS.SETUP_REPO;
          return (
            <ActionPill
              key={actionKey(action)}
              action={action}
              onClick={handlePillClick}
              busy={isSetupRepo && launching}
              buttonRef={isSetupRepo ? setupPillRef : undefined}
            />
          );
        })}

        {/* "..." manage button */}
        <button
          ref={moreButtonRef}
          type="button"
          onClick={handleOpenPanel}
          title="Manage pinned actions"
          className={[
            "flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid leading-none",
            "transition-colors duration-150",
            panelOpen
              ? "border-primary-5 bg-fill-2 text-primary-6"
              : "border-border-2 bg-bg-2 text-text-3 hover:border-border-3 hover:bg-fill-2 hover:text-text-2",
          ].join(" ")}
        >
          <MoreHorizontal size={13} strokeWidth={1.75} />
        </button>

        <PinActionsPanel
          visible={panelOpen}
          anchorRect={anchorRect}
          availableItems={availableItems}
          pinnedActions={pinnedActions}
          onTogglePin={handleTogglePin}
          onClose={handleClosePanel}
          loading={loadingItems}
        />

        {/* Repo picker — shown when Setup Repo clicked without an active repo */}
        {repoPicker && pickerAnchor && (
          <div
            ref={pickerRef}
            className="fixed z-[9999] min-w-[220px] overflow-hidden rounded-xl border border-border-2 bg-bg-2 py-1 shadow-lg"
            style={{
              bottom: window.innerHeight - pickerAnchor.top + 6,
              left: pickerAnchor.left,
            }}
          >
            <div className="px-3 py-1.5 text-[11px] font-medium text-text-3">
              Select a repo to set up
            </div>
            {repos.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-text-3">
                No repos found. Open a workspace first.
              </div>
            ) : (
              repos.slice(0, 8).map((repo) => {
                const targetPath = repo.path ?? "";
                return (
                  <button
                    key={repo.id}
                    type="button"
                    disabled={!targetPath}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-1 hover:bg-fill-2 disabled:cursor-default disabled:opacity-40"
                    onClick={() => {
                      if (!targetPath) return;
                      setRepoPicker(false);
                      setSetupRepoPath(targetPath);
                      void doLaunchSetup(targetPath);
                    }}
                  >
                    <span className="truncate font-medium">{repo.name}</span>
                    {targetPath && (
                      <span className="ml-auto shrink-0 truncate text-[11px] text-text-3">
                        {targetPath
                          .replace(/\/$/, "")
                          .split("/")
                          .slice(-3, -1)
                          .join("/")}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }
);

PinnedActionsBar.displayName = "PinnedActionsBar";

export default PinnedActionsBar;
