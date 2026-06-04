/**
 * SessionCreatorChatPanel — Handler Hook
 *
 * Extracts the screen-sharing flow, repo/branch selection handlers, and
 * agent category selection logic from SessionCreatorChatPanel into a
 * dedicated hook to keep the component file under the 600-line limit.
 */
import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type WingmanMonitor,
  wingmanListMonitors,
  wingmanOpenWindow,
} from "@src/api/tauri/agent";
import { KEY_SOURCE } from "@src/api/tauri/session";
import type { AdvancedConfig } from "@src/features/SessionCreator/types";
import {
  createSystemPathSessionSource,
  getSystemPathIdFromRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import {
  isSourceCompatibleWithAgent,
  useAgentCompatibility,
} from "@src/hooks/models/useAgentCompatibility";
import { preloadWingmanWindows } from "@src/router/lazy/preload";
import type { AgentSelection } from "@src/scaffold/GlobalSpotlight/palettes";
import type { RepoItem } from "@src/scaffold/GlobalSpotlight/types";
import { REPO_KIND, type RepoKind } from "@src/store/repo/types";
import { sessionCreatorStateAtom, sessionSourceAtom } from "@src/store/session";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseSessionCreatorHandlersOptions {
  reposList: Array<{
    id: string;
    name: string;
    path?: string;
    fs_uri?: string;
    kind?: string;
  }>;
  currentBranch: string | undefined;
  effectiveSource: {
    branch?: string;
    repoId?: string;
    repoName?: string;
    repoPath?: string;
  } | null;
  advancedConfig: AdvancedConfig;
  setAdvancedConfig: (config: AdvancedConfig) => void;
  selectRepo: (repoId: string) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSessionCreatorChatPanelHandlers({
  reposList,
  currentBranch,
  effectiveSource,
  advancedConfig,
  setAdvancedConfig,
  selectRepo,
}: UseSessionCreatorHandlersOptions) {
  const { t } = useTranslation();
  const { registry } = useAgentCompatibility();
  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const setSessionSource = useSetAtom(sessionSourceAtom);

  // ── Screen sharing ────────────────────────────────────────────────────────

  const [screenPickerMonitors, setScreenPickerMonitors] = useState<
    WingmanMonitor[] | null
  >(null);

  const handleShareScreenClick = useCallback(async () => {
    try {
      const monitors = await wingmanListMonitors();
      if (monitors.length <= 1) {
        await wingmanOpenWindow(undefined, monitors[0]?.index, true);
        return;
      }
      setScreenPickerMonitors(monitors);
    } catch {
      wingmanOpenWindow(undefined, undefined, true).catch(() => {});
    }
  }, []);

  const handleScreenPicked = useCallback((monitorIndex: number) => {
    setScreenPickerMonitors(null);
    wingmanOpenWindow(undefined, monitorIndex, true).catch(() => {});
  }, []);

  // ── Repo / branch selection ───────────────────────────────────────────────

  // "Switch workspace too?" confirmation path: update the global repo
  // selection to the picked repo and keep the session draft aligned with it.
  const handleRepoChange = useCallback(
    (repoId: string, options?: { repoKind?: RepoKind }) => {
      selectRepo(repoId);
      const repo = reposList.find((repoItem) => repoItem.id === repoId);
      const isFolder =
        options?.repoKind === REPO_KIND.FOLDER ||
        repo?.kind === REPO_KIND.FOLDER;
      setSessionSource({
        type: "local",
        repoId,
        repoName: repo?.name,
        repoPath: repo?.path || repo?.fs_uri,
        branch: isFolder
          ? undefined
          : (effectiveSource?.branch ?? currentBranch),
      });
    },
    [
      selectRepo,
      reposList,
      currentBranch,
      effectiveSource?.branch,
      setSessionSource,
    ]
  );

  // Session-only repo pick; the global repo selection is untouched.
  const handleRepoSelectForSession = useCallback(
    (selectedRepoId: string, repo: RepoItem) => {
      const systemPathId = getSystemPathIdFromRepoItem(repo);
      if (systemPathId) {
        setSessionSource(createSystemPathSessionSource(systemPathId, t));
        return;
      }

      const isFolder = repo.kind === REPO_KIND.FOLDER;
      setSessionSource({
        type: "local",
        repoId: selectedRepoId,
        repoName: repo.name,
        repoPath: repo.fs_uri,
        branch: isFolder ? undefined : currentBranch,
      });
    },
    [currentBranch, setSessionSource, t]
  );

  // ── Agent category selection ──────────────────────────────────────────────

  const [requestModelOpen, setRequestModelOpen] = useState(false);

  const handleCategorySelect = useCallback(
    (selection: AgentSelection) => {
      setCreatorState((prev) => ({
        ...prev,
        dispatchCategory: selection.category,
        targetKind: selection.targetKind,
        selectedAgentDefinitionId: selection.agentDefinitionId ?? null,
        selectedAgentOrgId: selection.agentOrgId ?? null,
        agentName: selection.agentName,
        agentIconId: selection.agentIconId ?? null,
        cliAgentType: selection.cliAgentType ?? null,
      }));

      const newCliType = selection.cliAgentType;
      const hasModel = Boolean(
        advancedConfig.model || advancedConfig.listingModel
      );
      const hasSource = Boolean(advancedConfig.selectedSourceModelType);
      const isHosted = advancedConfig.keySource === KEY_SOURCE.HOSTED;

      const isSourceCompatible =
        !hasSource ||
        isHosted ||
        !newCliType ||
        isSourceCompatibleWithAgent(
          registry,
          selection.category,
          newCliType,
          advancedConfig.selectedSourceModelType!
        );

      if (!isSourceCompatible) {
        setAdvancedConfig({
          ...advancedConfig,
          keySource: advancedConfig.keySource,
          cliAgentType: newCliType,
        });
        setRequestModelOpen(true);
      } else if (!hasModel || !hasSource) {
        if (newCliType) {
          setAdvancedConfig({ ...advancedConfig, cliAgentType: newCliType });
        }
        setRequestModelOpen(true);
      } else {
        if (newCliType) {
          setAdvancedConfig({ ...advancedConfig, cliAgentType: newCliType });
        }
      }
    },
    [setCreatorState, setAdvancedConfig, advancedConfig, registry]
  );

  return {
    // Screen sharing
    screenPickerMonitors,
    setScreenPickerMonitors,
    handleShareScreenClick,
    handleScreenPicked,
    preloadWingmanWindows,

    // Repo
    handleRepoChange,
    handleRepoSelectForSession,

    // Category / model
    requestModelOpen,
    setRequestModelOpen,
    handleCategorySelect,
  };
}
