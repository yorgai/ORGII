/**
 * useSessionCreator Hook
 *
 * Main orchestrating hook for SessionCreator feature.
 * Combines all sub-hooks and manages shared state, refs, and global interactions.
 *
 * Model/source selection is derived from `creatorDefaultModelSelectionAtom` (single source
 * of truth). There is no local `useState<AdvancedConfig>` — the atom is always
 * authoritative, which eliminates the startup race between localStorage peek,
 * atom hydration, and the hydration-correction effect.
 *
 * @example
 * const sessionCreator = useSessionCreator();
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { isHostedKey } from "@src/api/tauri/session";
import { useImageAttachment } from "@src/engines/ChatPanel/hooks/useInputArea/useImageAttachment";
import { useSessionDiscovery } from "@src/engines/SessionCore/hooks/session/useSessionDiscovery";
import type { SessionCreatorLaunchMode } from "@src/features/SessionCreator/types";
import { createSystemPathSessionSource } from "@src/features/SessionCreator/utils/systemPathSource";
import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { useAddToAgentInsertion, useTiptapInput } from "@src/hooks/input";
import {
  SYSTEM_PATH_ID,
  type SessionSource,
  agentIconIdAtom,
  cliAgentTypeAtom,
  dispatchCategoryAtom,
  selectedAgentDefinitionIdAtom,
  sessionSourceAtom,
} from "@src/store/session/creatorStateAtom";
import { isMultiRootWorkspaceAtom } from "@src/store/ui/workspaceFoldersAtom";
import { primaryFolderAtom } from "@src/store/workspace/derived";
import type { SlashItem } from "@src/types/extensions";
import { getRustAgentType } from "@src/util/session/sessionDispatch";

import type { UseSessionCreatorReturn } from "./types";
import { useAdvancedConfig } from "./useAdvancedConfig";
import { useDraftManagement } from "./useDraftManagement";
import { useFileUpload } from "./useFileUpload";
import { useMarketDeeplink } from "./useMarketDeeplink";
import { useSessionLaunch } from "./useSessionLaunch";
import { useSessionValidation } from "./useSessionValidation";

export interface UseSessionCreatorOptions {
  launchMode?: SessionCreatorLaunchMode;
  /**
   * Synthetic slash items appended to the `/` menu in addition to the
   * backend-discovered items. Variants use this to surface variant-only
   * commands (e.g. the Inbox variant exposes `Start sessions` and
   * `End all sessions`). Intercept selection via `onSlashSelectIntercept`.
   */
  extraSlashItems?: SlashItem[];
  /**
   * Called when a slash item is selected, before the default handler. If
   * this returns `true`, the default behaviour (clear editor + insert the
   * command name) is skipped — the variant has fully handled the action.
   */
  onSlashSelectIntercept?: (item: SlashItem) => boolean;
}

export function useSessionCreator(
  options: UseSessionCreatorOptions = {}
): UseSessionCreatorReturn {
  const { launchMode, extraSlashItems, onSlashSelectIntercept } = options;
  // ============================================
  // Refs
  // ============================================

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const dispatchCategory = useAtomValue(dispatchCategoryAtom);
  const selectedAgentDefinitionId = useAtomValue(selectedAgentDefinitionIdAtom);
  const agentIconId = useAtomValue(agentIconIdAtom);
  const cliAgentType = useAtomValue(cliAgentTypeAtom);
  const isOSMode =
    dispatchCategory === "rust_agent" &&
    getRustAgentType(selectedAgentDefinitionId) === "os";

  // ============================================
  // Tiptap Input Hook
  // ============================================

  const {
    tiptapRef,
    atDropdownRef,
    contextMenuKeyboardHandlerRef,
    slashCommandKeyboardHandlerRef,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    handleAtMention,
    handleAtMentionClose,
    handleAtSelect,
    handleAtMentionClick,
    isDark,
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect: baseHandleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredSlashItems: baseFilteredSlashItems,
    slashLoading,
    prefetchSlashItems,
  } = useTiptapInput({
    onContentChange: (content) => {
      setEditorContent(content);
    },
    // SessionCreator configures a *new* session — `useSessionId()` would
    // otherwise resolve to the previously-active session's id and a
    // `/mode` pick here would silently rewrite that session's
    // ModePill on the row.
    creatorDefaultMode: true,
  });

  // Insert file/line references from WorkStation "Add to agent" menu.
  useAddToAgentInsertion(tiptapRef);

  // ── Variant-supplied slash extras ────────────────────────────────────────
  // `extraSlashItems` lets variants (currently the Inbox variant) inject
  // synthetic commands into the `/` menu without forking the slash
  // pipeline. They get filtered alongside backend items by `slashQuery` so
  // the dropdown stays a single ranked list.
  const filteredSlashItems = useMemo<SlashItem[]>(() => {
    if (!extraSlashItems || extraSlashItems.length === 0) {
      return baseFilteredSlashItems;
    }
    const query = slashQuery.trim().toLowerCase();
    const extras = query
      ? extraSlashItems.filter(
          (item) =>
            item.name.toLowerCase().includes(query) ||
            item.description.toLowerCase().includes(query)
        )
      : extraSlashItems;
    return [...extras, ...baseFilteredSlashItems];
  }, [extraSlashItems, baseFilteredSlashItems, slashQuery]);

  const handleSlashSelect = useCallback(
    (item: SlashItem) => {
      if (onSlashSelectIntercept?.(item)) return;
      baseHandleSlashSelect(item);
    },
    [onSlashSelectIntercept, baseHandleSlashSelect]
  );

  // ============================================
  // Repo Selection
  // ============================================

  // `sessionSourceAtom` holds the SessionCreator's *divergence* from the
  // global toolbar. `null` ≡ no divergence → mirror the toolbar. The only
  // bridge back to the global atom is the explicit "also switch workspace?"
  // confirmation in SessionInfoLine (which calls `selectRepo`).
  const {
    selectedRepoId: globalRepoId,
    currentBranch: globalBranch,
    repos,
    selectBranch,
  } = useRepoSelection({ autoLoad: true });

  const sessionSource = useAtomValue(sessionSourceAtom);
  const setSessionSource = useSetAtom(sessionSourceAtom);

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const primaryFolder = useAtomValue(primaryFolderAtom);

  // When the global toolbar repo changes (e.g. user picks a different repo
  // from the toolbar pill), clear any session-specific divergence so the
  // creator follows the new selection. We only clear when the stored draft
  // points to a *different* repo — if it matches (e.g. handleRepoChange
  // just synced them), we keep the draft so the branch is preserved.
  const prevGlobalRepoIdRef = useRef(globalRepoId);
  useEffect(() => {
    if (prevGlobalRepoIdRef.current !== globalRepoId) {
      prevGlobalRepoIdRef.current = globalRepoId;
      if (sessionSource && sessionSource.repoId !== globalRepoId) {
        setSessionSource(null);
      }
    }
  }, [globalRepoId, sessionSource, setSessionSource]);

  // `effectiveSource` is what launch + display both consume. When no
  // divergence is stored, synthesize it live from the toolbar selection so
  // the creator follows the workspace without needing a seed write.
  const effectiveSource = useMemo<SessionSource | null>(() => {
    if (sessionSource) return sessionSource;

    if (isOSMode) {
      return createSystemPathSessionSource(SYSTEM_PATH_ID.HOME, t);
    }

    // Workspace mode: use the primary folder so launch gets the correct
    // workspace path rather than a stale selectedRepoIdAtom value.
    if (isMultiRoot && primaryFolder) {
      return {
        type: "local",
        repoId: primaryFolder.repoId ?? primaryFolder.id,
        repoName: primaryFolder.name,
        repoPath: primaryFolder.path,
        branch: globalBranch || undefined,
      };
    }

    if (!globalRepoId) return null;
    const repo = repos.find((repoItem) => repoItem.id === globalRepoId);
    if (!repo) return null;
    return {
      type: "local",
      repoId: globalRepoId,
      repoName: repo.name,
      repoPath: repo.path || repo.fs_uri,
      branch: globalBranch || undefined,
    };
  }, [
    sessionSource,
    isOSMode,
    t,
    isMultiRoot,
    primaryFolder,
    globalRepoId,
    globalBranch,
    repos,
  ]);

  // Pure branch setter for the session-scoped pill: writes to the draft
  // atom only, no git checkout. If there's no active draft yet we
  // materialize one from `effectiveSource` so the change is captured as a
  // divergence from the current mirror.
  const setDraftBranch = useCallback(
    (branch: string) => {
      if (!effectiveSource) return;
      setSessionSource({
        ...effectiveSource,
        branch: branch || undefined,
      });
    },
    [effectiveSource, setSessionSource]
  );

  // ============================================
  // Custom Hooks
  // ============================================

  const { providers, agents } = useSessionDiscovery({ autoLoad: true });

  // ============================================
  // Local State
  // ============================================

  const [editorContent, setEditorContent] = useState("");
  const [sessionName, setSessionName] = useState("");

  // ============================================
  // Model/Source: derive from atom (single source of truth)
  // ============================================

  const { advancedConfig, setAdvancedConfig, setLastModelSelection } =
    useAdvancedConfig();

  // ============================================
  // Market URL Deeplink (one-shot on mount)
  // ============================================

  useMarketDeeplink({ setLastModelSelection });

  // ============================================
  // Sub-Hooks
  // ============================================

  // File Upload
  const {
    uploadedFiles,
    setUploadedFiles,
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
  } = useFileUpload({ fileInputRef, tiptapRef });

  // Image Attachments
  const {
    images: attachedImages,
    handleImagePaste,
    clearImages,
    removeImage,
    hasImages,
  } = useImageAttachment();

  const imageDataUrls = useMemo(
    () => attachedImages.map((img) => img.dataUrl),
    [attachedImages]
  );

  // Skip draft loading when navigated from marketplace with URL params
  const hasListingParams = !!searchParams.get("cliAgentType");

  // Draft Management — only persists per-message fields (text, files).
  // Model selection lives in `creatorDefaultModelSelectionAtom`.
  useDraftManagement({
    sessionName,
    editorContent,
    uploadedFiles,
    agentIconId,
    cliAgentType,
    setSessionName,
    setEditorContent,
    setUploadedFiles,
    tiptapRef,
    skipDraftLoading: hasListingParams,
  });

  // Session Validation — validates the session-scoped draft, not the global
  // toolbar. The user may pick a different repo than the active workspace.
  const { validateSessionConfig } = useSessionValidation({
    effectiveRepoId: effectiveSource?.repoId ?? "",
    editorContent,
    advancedConfig,
    providers,
    agents,
  });

  const handleLaunchSuccess = useCallback(() => {
    // Pair-based storage: the last pair remains valid after launch.
    // No fields to reset — the user will pick a new pair when needed.
  }, []);

  // Session Launch
  const {
    isLoading,
    handleLaunch,
    showAddFundsModal,
    closeAddFundsModal,
    showBuyCreditsModal,
    closeBuyCreditsModal,
    pendingBonusInfo,
    acceptBonus,
    declineBonus,
  } = useSessionLaunch({
    effectiveSource,
    editorContent,
    sessionName,
    advancedConfig,
    isContentEmpty: !editorContent || !editorContent.trim(),
    validateSessionConfig,
    tiptapRef,
    onLaunchSuccess: handleLaunchSuccess,
    launchMode,
    imageDataUrls,
    clearImages,
  });

  // Note: Listing model fetching removed - proxy handles provider matching now.
  // The model/platform/tier are stored directly from the ModelSelectorMenu.

  // ============================================
  // Editor Handlers
  // ============================================

  const handleContentChange = useCallback(
    (text: string) => {
      setEditorContent(text);
    },
    [setEditorContent]
  );

  // isContentEmpty is now a computed boolean
  const isContentEmpty = !editorContent || !editorContent.trim();

  const canLaunch = useMemo(() => {
    if (isContentEmpty) return false;
    if (
      dispatchCategory === "rust_agent" &&
      !isOSMode &&
      !effectiveSource?.repoId
    ) {
      return false;
    }

    if (isHostedKey(advancedConfig.keySource)) {
      return !!advancedConfig.cliAgentType;
    }

    const hasModelOrAccount =
      !!advancedConfig.selectedAccountId ||
      !!advancedConfig.model ||
      !!advancedConfig.cliAgentType;
    return hasModelOrAccount;
  }, [
    isContentEmpty,
    advancedConfig,
    dispatchCategory,
    effectiveSource,
    isOSMode,
  ]);

  // ============================================
  // Return
  // ============================================

  return {
    // Refs
    fileInputRef,
    tiptapRef,
    atDropdownRef,
    contextMenuKeyboardHandlerRef,
    slashCommandKeyboardHandlerRef,

    // State
    editorContent,
    setEditorContent,
    sessionName,
    setSessionName,
    uploadedFiles,
    isLoading,
    advancedConfig,
    setAdvancedConfig,

    // Computed — draft overlaid on the global toolbar (see effectiveSource).
    effectiveSource,
    repos,

    // Discovery data
    providers,
    agents,

    // Context input
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    isDark,

    // Slash command
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredSlashItems,
    slashLoading,
    prefetchSlashItems,

    // Event handlers
    handleFileUpload,
    handleRemoveFile,
    handleUploadClick,
    handleContentChange,
    handleAtMention,
    handleAtMentionClose,
    handleAtMentionClick,
    handleAtSelect,
    handleLaunch,
    canLaunch,

    // Wallet/credit balance modal triggers (modals live under `.market/`,
    // OSS render sites currently mount nothing — see types.ts for why
    // the seam is kept here).
    showAddFundsModal,
    closeAddFundsModal,
    showBuyCreditsModal,
    closeBuyCreditsModal,

    // Bonus modal
    pendingBonusInfo,
    acceptBonus,
    declineBonus,

    // Branch handlers.
    //   - `handleBranchChange` (session-scoped): writes sessionSource.branch
    //     without triggering a git checkout. Use from the SessionCreator pill.
    //   - `checkoutBranch`: real git checkout (switches the active workspace
    //     branch). Use only from the "also switch workspace?" confirmation.
    handleBranchChange: setDraftBranch,
    checkoutBranch: selectBranch,

    // Image attachments
    attachedImages,
    handleImagePaste,
    removeImage,
    clearImages,
    hasImages,
  };
}

export default useSessionCreator;
