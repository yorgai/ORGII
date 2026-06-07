/**
 * useWorkspaceForm Hook
 *
 * Manages local workspace creation and import form state and actions.
 * Uses .git presence to decide whether a directory is a Git workspace.
 */
import { ask, open } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { zodActionRegistry } from "@src/ActionSystem/schema/zodRegistry";
import { repoApi } from "@src/api/tauri/repo";
import Message from "@src/components/Toast";
import { createLogger } from "@src/hooks/logger";

const logger = createLogger("WorkspaceForm");
const SYSTEM_WORKSPACE_FOLDER_NAMES = new Set([
  "desktop",
  "documents",
  "downloads",
]);

function getNormalizedPathSegments(path: string): string[] {
  return path
    .replace(/^file:\/\//, "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

function isSystemWorkspaceRoot(path: string): boolean {
  const segments = getNormalizedPathSegments(path);
  const lastSegment = segments.at(-1)?.toLowerCase();
  return Boolean(lastSegment && SYSTEM_WORKSPACE_FOLDER_NAMES.has(lastSegment));
}

export interface UseWorkspaceFormOptions {
  onSuccess?: (workspaceId?: string) => Promise<void>;
  onClose?: () => void;
}

export interface UseWorkspaceFormReturn {
  workspaceName: string;
  setWorkspaceName: (name: string) => void;
  workspacePath: string;
  setWorkspacePath: (path: string) => void;
  loading: boolean;
  handleChoosePath: (mode: "new" | "existing") => Promise<string | null>;
  handleCreateWorkspace: (
    name: string,
    path: string
  ) => Promise<string | undefined>;
  handleImportWorkspace: (path: string) => Promise<string | undefined>;
  handleOpenLocalWorkspace: (
    initialPath?: string
  ) => Promise<string | undefined>;
  resetForm: () => void;
}

export function useWorkspaceForm(
  options: UseWorkspaceFormOptions = {}
): UseWorkspaceFormReturn {
  const { t } = useTranslation();
  const { onSuccess, onClose } = options;

  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setWorkspaceName("");
    setWorkspacePath("");
    setLoading(false);
  }, []);

  const handleChoosePath = useCallback(
    async (mode: "new" | "existing"): Promise<string | null> => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title:
            mode === "new"
              ? "Choose folder to create workspace"
              : "Choose existing workspace",
        });

        return selected && typeof selected === "string" ? selected : null;
      } catch (error) {
        logger.error("Failed to open folder picker:", error);
        Message.error("Failed to select directory");
        return null;
      }
    },
    []
  );

  const shouldInitializeGit = useCallback(
    async (path: string): Promise<boolean> => {
      if (isSystemWorkspaceRoot(path)) return false;

      return ask(t("selectors.repo.gitInitPrompt.message"), {
        title: t("selectors.repo.gitInitPrompt.title"),
        kind: "info",
        okLabel: t("selectors.repo.gitInitPrompt.ok"),
        cancelLabel: t("selectors.repo.gitInitPrompt.cancel"),
      });
    },
    [t]
  );

  const handleCreateWorkspace = useCallback(
    async (name: string, path: string): Promise<string | undefined> => {
      if (!name.trim() || !path.trim()) return undefined;

      setLoading(true);
      try {
        const trimmedPath = path.trim();
        const trimmedName = name.trim();
        const pathSeparator = trimmedPath.includes("\\") ? "\\" : "/";
        const fullPath = trimmedPath.endsWith(pathSeparator)
          ? `${trimmedPath}${trimmedName}`
          : `${trimmedPath}${pathSeparator}${trimmedName}`;

        const initializeGit = await shouldInitializeGit(fullPath);
        const result = await zodActionRegistry.execute("repo.create", {
          path: fullPath,
          name: trimmedName,
          git: initializeGit,
        });

        if (result.success) {
          const workspaceId = (result.data as { repo_id?: string } | undefined)
            ?.repo_id;
          Message.success("Workspace created");
          resetForm();
          onClose?.();
          await onSuccess?.(workspaceId);
          return workspaceId;
        }

        Message.error(result.message || "Failed to create workspace");
        return undefined;
      } catch (error) {
        Message.error(
          error instanceof Error ? error.message : "Failed to create workspace"
        );
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [resetForm, onClose, onSuccess, shouldInitializeGit]
  );

  const handleImportWorkspace = useCallback(
    async (path: string): Promise<string | undefined> => {
      if (!path.trim()) return undefined;

      setLoading(true);
      try {
        const fsPath = path.trim();
        const isGitWorkspace = await repoApi.checkIsGitRepo(fsPath);
        const initializeGit = isGitWorkspace
          ? true
          : await shouldInitializeGit(fsPath);
        const result = initializeGit
          ? await repoApi.importLocalRepo({ fs_path: fsPath })
          : await repoApi.importWorkFolder({ fs_path: fsPath });
        const workspaceId = result.data.repo_id;
        Message.success("Workspace imported");
        resetForm();
        onClose?.();
        await onSuccess?.(workspaceId);
        return workspaceId;
      } catch (error) {
        Message.error(
          error instanceof Error ? error.message : "Failed to import workspace"
        );
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [resetForm, onClose, onSuccess, shouldInitializeGit]
  );

  const handleOpenLocalWorkspace = useCallback(
    async (initialPath?: string): Promise<string | undefined> => {
      const selectedPath = initialPath ?? (await handleChoosePath("existing"));
      if (!selectedPath) return undefined;
      return handleImportWorkspace(selectedPath);
    },
    [handleChoosePath, handleImportWorkspace]
  );

  return {
    workspaceName,
    setWorkspaceName,
    workspacePath,
    setWorkspacePath,
    loading,
    handleChoosePath,
    handleCreateWorkspace,
    handleImportWorkspace,
    handleOpenLocalWorkspace,
    resetForm,
  };
}

export default useWorkspaceForm;
