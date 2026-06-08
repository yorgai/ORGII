/**
 * SessionInfoLine Component
 *
 * Displays session configuration summary as a shared `PillGroup`:
 *   "[repo] | [branch]"  (resting, no border)
 * Hovering a segment promotes it to an independent pill and hides the
 * adjacent divider; the other segment stays transparent.
 *
 * Supports two repo-click modes via props:
 * - onRepoChange (switch): switches the Human Station workspace
 * - onRepoSelect (session-only): picks a repo for session creation only.
 *   Flow: repo → branch → "switch workspace too?" selector
 */
import {
  BranchDropdown,
  BranchPalette,
  RepoDropdown,
  RepoPalette,
} from "@/src/scaffold/GlobalSpotlight/palettes";
import type { RepoItem } from "@/src/scaffold/GlobalSpotlight/types";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import PillGroup, { type PillGroupVariant } from "@src/components/PillGroup";
import RunningLocationDropdownPanel from "@src/components/RunningLocationDropdownPanel";
import {
  RUNNING_LOCATIONS,
  type RunningLocation,
} from "@src/config/sessionCreatorConfig";
import {
  isSystemHomeRepoItem,
  isSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";
import { modelPickerStyleAtom } from "@src/store/ui/chatPanelAtom";
import {
  branchSelectorOpenAtom,
  locationSelectorOpenAtom,
  repoSelectorOpenAtom,
} from "@src/store/ui/overlayAtom";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";
import { workspaceNameAtom } from "@src/store/workspace/derived";

import SwitchWorkspaceSelector from "./SessionInfoLine/SwitchWorkspaceSelector";
import {
  buildSessionInfoSegments,
  getSessionInfoDisplayState,
} from "./SessionInfoLine/buildSessionInfoSegments";
import { type LocationRow } from "./SessionInfoLine/locationConfig";
import { useSystemPathRepoItems } from "./SessionInfoLine/useSystemPathRepoItems";

// ============================================
// Type Definitions
// ============================================

export interface SessionInfoLineProps {
  /** Current repository ID */
  repoId?: string;
  /** Current repository name */
  repoName?: string;
  /** Current repository path (fs_uri) - needed for branch fetching */
  repoPath?: string;
  /**
   * Switch-workspace handler. Selecting a repo updates the Human Station
   * workspace atom AND the session source. Optional when `disabled` is
   * true (read-only mode used by post-launch surfaces).
   */
  onRepoChange?: (repoId: string, options?: { repoKind?: RepoKind }) => void;
  /**
   * Session-only handler. When provided, selecting a repo calls this
   * (updates session source only). After branch is picked, a follow-up
   * selector asks whether to switch the workspace too.
   * If absent, onRepoChange is used directly.
   */
  onRepoSelect?: (repoId: string, repo: RepoItem) => void;
  /** Local/Git source kind — `folder` hides branch UI */
  repoKind?: RepoKind;
  /** Whether to include system path sources in the source selector. */
  includeSystemPaths?: boolean;
  /** Current branch name */
  branchName?: string;
  /** Handler for branch change. Optional when `disabled` is true. */
  onBranchChange?: (branch: string) => void;
  /** Whether branches are loading */
  branchLoading?: boolean;
  /**
   * Read-only mode: pills render with disabled styling and clicks are
   * suppressed (no selectors open). Used by post-launch surfaces where
   * repo / branch / location are immutable.
   */
  disabled?: boolean;
  /**
   * Suppress the branch segment regardless of `repoKind`. Used in
   * read-only post-launch contexts where branch is locked and not
   * interesting to display.
   */
  hideBranch?: boolean;
  /**
   * `PillGroup` visual variant. Use `ghost` for dense factory headers where
   * the surrounding chrome already provides visual separation; the default
   * `default` variant draws a border ring on hover/active.
   *
   * Ignored when `fullWidth` is true (forces `solid`).
   */
  pillVariant?: PillGroupVariant;
  /**
   * When true, the row sits in a full-width SessionCreator surface (e.g. the
   * fullScreen ChatPanel creator) immediately under the composer input. Each
   * pill renders with a persistent `bg-chat-input` fill so the segments
   * align visually with the input above instead of reading as naked text on
   * a darker strip.
   */
  fullWidth?: boolean;
  /**
   * When provided, adds a third segment for selecting the running location
   * (This Mac / New Worktree / Cloud) — modelled after Cursor's context bar.
   */
  worktreeLocation?: RunningLocation;
  onWorktreeLocationChange?: (location: RunningLocation) => void;
}

// ============================================
// Component
// ============================================

const SessionInfoLine: React.FC<SessionInfoLineProps> = ({
  repoId,
  repoName,
  repoPath,
  onRepoChange,
  onRepoSelect,
  repoKind,
  includeSystemPaths = false,
  branchName,
  onBranchChange,
  branchLoading,
  pillVariant = "default",
  fullWidth = false,
  worktreeLocation,
  onWorktreeLocationChange,
  disabled = false,
  hideBranch = false,
}) => {
  const effectivePillVariant: PillGroupVariant = fullWidth
    ? "solid"
    : pillVariant;
  const { t } = useTranslation();

  // ============================================
  // Selector State
  // ============================================

  const [isRepoSelectorOpen, setIsRepoSelectorOpen] = useState(false);
  const [isBranchSelectorOpen, setIsBranchSelectorOpen] = useState(false);
  const [isSwitchPromptOpen, setIsSwitchPromptOpen] = useState(false);

  const locationRows = useMemo<LocationRow[]>(
    () =>
      RUNNING_LOCATIONS.map((entry) => ({
        id: entry.id,
        disabled: entry.disabled === true,
      })),
    []
  );

  // Forward declaration: the actual `close` comes back from
  // `useDropdownEngine` below, but `handleLocationRowSelect` needs to
  // close the dropdown after committing. We route through a ref to
  // avoid a circular initialization.
  const closeLocationRef = useRef<() => void>(() => undefined);

  const handleLocationRowSelect = useCallback(
    (row: LocationRow) => {
      onWorktreeLocationChange?.(row.id);
      closeLocationRef.current();
    },
    [onWorktreeLocationChange]
  );

  const {
    isOpen: isLocationDropdownOpen,
    isPositioned: isLocationPositioned,
    toggle: toggleLocation,
    close: closeLocation,
    triggerRef: locationTriggerRef,
    panelRef: locationPanelRef,
    panelPosition: locationPanelPosition,
    keyboard: locationKeyboard,
  } = useDropdownEngine<HTMLButtonElement, LocationRow>({
    gap: 6,
    align: "left",
    // Default: open downward; flip up only if the panel would clip
    // against the bottom of the viewport.
    placement: "auto",
    listNavigation: {
      items: locationRows,
      onSelect: handleLocationRowSelect,
      isItemSelectable: (row) => !row.disabled,
    },
  });
  useEffect(() => {
    closeLocationRef.current = closeLocation;
  }, [closeLocation]);

  // In session-only mode (onRepoSelect provided), we stash the picked repo
  // so that after branch is chosen we can ask whether to also switch
  // the Human Station workspace.
  const [pendingSwitch, setPendingSwitch] = useState<{
    repoId: string;
    repoName: string;
    repoKind?: RepoKind;
  } | null>(null);

  // BranchPalette calls both onSelect and onClose when a branch is picked.
  // This flag tells handleBranchClose to preserve pendingSwitch in that case
  // so the follow-up switch prompt can open.
  const branchJustSelectedRef = useRef(false);

  // ============================================
  // Anchored dropdown refs (used when modelPickerStyle === "dropdown")
  // ============================================

  const repoTriggerRef = useRef<HTMLButtonElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);
  const modelPickerStyle = useAtomValue(modelPickerStyleAtom);
  const useDropdownPicker = modelPickerStyle === "dropdown";

  // ============================================
  // Handlers
  // ============================================

  const handleRepoTriggerClick = useCallback(() => {
    if (disabled) return;
    setIsRepoSelectorOpen((isOpen) => !isOpen);
  }, [disabled]);

  const handleBranchTriggerClick = useCallback(() => {
    if (disabled) return;
    setIsBranchSelectorOpen((isOpen) => !isOpen);
  }, [disabled]);

  const handleRepoSelected = useCallback(
    (selectedRepoId: string, repo: RepoItem) => {
      if (isSystemPathRepoItem(repo)) {
        onRepoSelect?.(selectedRepoId, repo);
        setIsRepoSelectorOpen(false);
        setPendingSwitch(null);
        return;
      }

      const kind = (repo.kind as RepoKind) ?? REPO_KIND.GIT;
      const isFolder = kind === REPO_KIND.FOLDER;

      if (onRepoSelect) {
        onRepoSelect(selectedRepoId, repo);
        setIsRepoSelectorOpen(false);
        setPendingSwitch({
          repoId: selectedRepoId,
          repoName: repo.name,
          repoKind: kind,
        });
        if (isFolder) {
          // Folders have no branch — jump straight to switch prompt
          setTimeout(() => setIsSwitchPromptOpen(true), 100);
        } else {
          setTimeout(() => setIsBranchSelectorOpen(true), 100);
        }
      } else {
        onRepoChange?.(selectedRepoId, { repoKind: kind });
        setIsRepoSelectorOpen(false);
        if (!isFolder) {
          setTimeout(() => setIsBranchSelectorOpen(true), 100);
        }
      }
    },
    [onRepoSelect, onRepoChange]
  );

  const systemPathSourceItems = useSystemPathRepoItems(includeSystemPaths, t);

  const handleBranchSelect = useCallback(
    (branch: string) => {
      branchJustSelectedRef.current = true;
      onBranchChange?.(branch);
      setIsBranchSelectorOpen(false);
      // In session-only mode, advance to switch prompt after branch is picked
      if (pendingSwitch) {
        setTimeout(() => setIsSwitchPromptOpen(true), 100);
      }
    },
    [onBranchChange, pendingSwitch]
  );

  const handleBranchClose = useCallback(() => {
    setIsBranchSelectorOpen(false);
    // If the close was triggered by a successful select, keep pendingSwitch
    // so the switch prompt can open. Otherwise the user dismissed the
    // branch selector — drop any pending session-only state.
    if (branchJustSelectedRef.current) {
      branchJustSelectedRef.current = false;
    } else {
      setPendingSwitch(null);
    }
  }, []);

  const handleConfirmSwitch = useCallback(() => {
    if (pendingSwitch) {
      onRepoChange?.(pendingSwitch.repoId, {
        repoKind: pendingSwitch.repoKind,
      });
    }
    setIsSwitchPromptOpen(false);
    setPendingSwitch(null);
  }, [pendingSwitch, onRepoChange]);

  const handleSkipSwitch = useCallback(() => {
    setIsSwitchPromptOpen(false);
    setPendingSwitch(null);
  }, []);

  const handleSwitchPromptClose = useCallback(() => {
    setIsSwitchPromptOpen(false);
    setPendingSwitch(null);
  }, []);

  // ============================================
  // Display
  // ============================================

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const workspaceName = useAtomValue(workspaceNameAtom);

  const currentRepoItem = useMemo(
    () => ({
      id: repoId ?? "",
      name: repoName ?? "",
      kind: repoKind,
    }),
    [repoId, repoName, repoKind]
  );
  const isSystemPath =
    includeSystemPaths && isSystemPathRepoItem(currentRepoItem);
  const isSystemHome =
    includeSystemPaths && isSystemHomeRepoItem(currentRepoItem);

  const { sourceDisplayName, SourceIcon, hasSource, showBranchRow } = useMemo(
    () =>
      getSessionInfoDisplayState({
        isMultiRoot,
        workspaceName,
        repoName,
        repoKind,
        isSystemPathSource: isSystemPath,
        isSystemHomeSource: isSystemHome,
        hideBranch,
        t,
      }),
    [
      isMultiRoot,
      workspaceName,
      repoName,
      repoKind,
      isSystemPath,
      isSystemHome,
      hideBranch,
      t,
    ]
  );

  // Bridge global shortcut atoms (⌘., ⌥⌘., ⇧⌘.) → local dropdown state.
  // The atoms behave as one-shot signals: a shortcut handler flips them to
  // true, this component consumes the edge, opens the matching dropdown,
  // and flips the atom back to false so a second press re-triggers.
  //
  // We subscribe to the Jotai store directly (outside the React render
  // tree) rather than reading the atom via `useAtomValue` + `useEffect`.
  // That avoids the React Compiler `set-state-in-effect` rule, because
  // the setState calls run from a store subscription callback — the same
  // category as a DOM event listener — instead of synchronously inside a
  // render effect.
  const store = useStore();
  const setGlobalBranchSelectorOpen = useSetAtom(branchSelectorOpenAtom);
  const setGlobalRepoSelectorOpen = useSetAtom(repoSelectorOpenAtom);
  const setGlobalLocationSelectorOpen = useSetAtom(locationSelectorOpenAtom);

  // Latest gating flags + handlers accessed from the store subscription.
  // The subscription registers once per `store` instance; without a ref we
  // would have to re-subscribe on every prop change. The ref body is
  // refreshed in an effect (writing `.current` in render is disallowed by
  // the React Compiler `refs` rule).
  const bridgeStateRef = useRef({
    disabled,
    showBranchRow,
    repoId,
    worktreeLocation,
    isLocationDropdownOpen,
    toggleLocation,
  });
  useEffect(() => {
    bridgeStateRef.current = {
      disabled,
      showBranchRow,
      repoId,
      worktreeLocation,
      isLocationDropdownOpen,
      toggleLocation,
    };
  });

  useEffect(() => {
    const unsubBranch = store.sub(branchSelectorOpenAtom, () => {
      if (!store.get(branchSelectorOpenAtom)) return;
      setGlobalBranchSelectorOpen(false);
      const s = bridgeStateRef.current;
      if (s.disabled || !s.showBranchRow || !s.repoId) return;
      setIsBranchSelectorOpen(true);
    });
    const unsubRepo = store.sub(repoSelectorOpenAtom, () => {
      if (!store.get(repoSelectorOpenAtom)) return;
      const s = bridgeStateRef.current;
      if (s.disabled) return;
      setGlobalRepoSelectorOpen(false);
      setIsRepoSelectorOpen(true);
    });
    const unsubLocation = store.sub(locationSelectorOpenAtom, () => {
      if (!store.get(locationSelectorOpenAtom)) return;
      setGlobalLocationSelectorOpen(false);
      const s = bridgeStateRef.current;
      if (s.disabled || s.worktreeLocation === undefined) return;
      if (s.isLocationDropdownOpen) return;
      s.toggleLocation();
    });
    return () => {
      unsubBranch();
      unsubRepo();
      unsubLocation();
    };
  }, [
    store,
    setGlobalBranchSelectorOpen,
    setGlobalRepoSelectorOpen,
    setGlobalLocationSelectorOpen,
  ]);

  const handleLocationTriggerClick = useCallback(() => {
    if (disabled) return;
    toggleLocation();
  }, [disabled, toggleLocation]);

  const baseSegments = buildSessionInfoSegments({
    SourceIcon,
    hasSource,
    sourceDisplayName,
    isRepoSelectorOpen,
    handleRepoTriggerClick,
    showBranchRow,
    branchLoading,
    branchName,
    isBranchSelectorOpen,
    handleBranchTriggerClick,
    worktreeLocation,
    isLocationDropdownOpen,
    handleLocationTriggerClick,
    locationTriggerRef,
    disabled,
    t,
  });

  // Attach refs out-of-band so the React Compiler `refs` rule doesn't
  // flag passing locally-created refs through a plain function.
  const segments = baseSegments.map((segment) => {
    if (segment.id === "repo") return { ...segment, buttonRef: repoTriggerRef };
    if (segment.id === "branch")
      return { ...segment, buttonRef: branchTriggerRef };
    return segment;
  });

  return (
    <>
      <PillGroup
        segments={segments}
        className="flex-wrap"
        variant={effectivePillVariant}
      />

      {/* Repo Selector */}
      {useDropdownPicker ? (
        <RepoDropdown
          isOpen={isRepoSelectorOpen}
          onClose={() => setIsRepoSelectorOpen(false)}
          onSelect={handleRepoSelected}
          currentRepoId={repoId}
          anchorRef={repoTriggerRef}
          leadingRepos={systemPathSourceItems}
        />
      ) : (
        <RepoPalette
          isOpen={isRepoSelectorOpen}
          onClose={() => setIsRepoSelectorOpen(false)}
          onSelect={handleRepoSelected}
          currentRepoId={repoId}
          switchPathLabel={t("selectors.sessionInfo.sessionWorkspace")}
          hideActionClose
          leadingRepos={systemPathSourceItems}
        />
      )}

      {/* Branch Selector */}
      {showBranchRow &&
        repoId &&
        (useDropdownPicker ? (
          <BranchDropdown
            isOpen={isBranchSelectorOpen}
            onClose={handleBranchClose}
            onSelect={handleBranchSelect}
            repoId={repoId}
            repoPath={repoPath}
            currentBranchName={branchName}
            anchorRef={branchTriggerRef}
          />
        ) : (
          <BranchPalette
            isOpen={isBranchSelectorOpen}
            onClose={handleBranchClose}
            onSelect={handleBranchSelect}
            repoId={repoId}
            repoPath={repoPath}
            currentBranchName={branchName}
            variant="create-session"
            hideActionClose
          />
        ))}

      {/* Follow-up: switch workspace too? (opens after branch is chosen) */}
      {pendingSwitch && (
        <SwitchWorkspaceSelector
          isOpen={isSwitchPromptOpen}
          onClose={handleSwitchPromptClose}
          onSwitch={handleConfirmSwitch}
          onSkip={handleSkipSwitch}
          repoName={pendingSwitch.repoName}
        />
      )}

      {/* Location dropdown portal */}
      {worktreeLocation !== undefined &&
        isLocationDropdownOpen &&
        isLocationPositioned &&
        createPortal(
          <RunningLocationDropdownPanel
            panelRef={locationPanelRef}
            style={{
              position: "fixed",
              top: locationPanelPosition.top,
              bottom: locationPanelPosition.bottom,
              left: locationPanelPosition.left,
            }}
            selected={worktreeLocation}
            getItemProps={locationKeyboard.getItemProps}
            onSelect={(location) => {
              onWorktreeLocationChange?.(location);
              closeLocation();
            }}
          />,
          document.body
        )}
    </>
  );
};

export default SessionInfoLine;
