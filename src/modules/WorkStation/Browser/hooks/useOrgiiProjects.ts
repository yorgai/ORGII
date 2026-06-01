/**
 * useOrgiiProjects - Hook for ORGII project files
 *
 * Provides:
 * - List project files in a repo
 * - Extract projects from a file
 * - Get projects for a specific component
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { repoPathAtom } from "@src/engines/SessionCore/workspace/atoms/sessionAtoms";

// ============================================
// Types
// ============================================

/** Project info from Rust */
export interface ProjectInfo {
  /** Export name (e.g., "Primary") */
  export_name: string;
  /** Display name */
  name: string;
  /** Args/props for this project */
  args: Record<string, unknown>;
  /** Project description */
  description: string | null;
  /** Tags */
  tags: string[];
  /** Line number in source */
  line: number;
}

/** Project meta configuration from Rust */
export interface ProjectMeta {
  /** Component reference */
  component: string;
  /** Navigation title */
  title: string;
  /** Default args */
  default_args: Record<string, unknown>;
  /** Description */
  description: string | null;
  /** Tags */
  tags: string[];
}

/** Full project file info from Rust */
export interface ProjectFileInfo {
  /** File path */
  file: string;
  /** Meta configuration */
  meta: ProjectMeta;
  /** Individual projects */
  projects: ProjectInfo[];
}

export interface UseOrgiiProjectsReturn {
  /** List of project file paths in the repo */
  projectFiles: string[];
  /** Whether project files are loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh project file list */
  refresh: () => Promise<void>;
  /** Extract projects from a file */
  extractProjects: (filePath: string) => Promise<ProjectFileInfo | null>;
  /** Get projects for a component */
  getComponentProjects: (
    componentFile: string
  ) => Promise<ProjectFileInfo | null>;
  /** Cached project file info */
  projectCache: Map<string, ProjectFileInfo>;
}

// ============================================
// Hook
// ============================================

export interface UseOrgiiProjectsOptions {
  /** Optional repo path - if not provided, uses global repoPathAtom */
  repoPath?: string;
}

export function useOrgiiProjects(
  options: UseOrgiiProjectsOptions = {}
): UseOrgiiProjectsReturn {
  const globalRepoPath = useAtomValue(repoPathAtom);
  const repoPath = options.repoPath || globalRepoPath;

  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache for extracted projects (capped to prevent memory growth)
  const MAX_STORY_CACHE_SIZE = 100;
  const projectCache = useRef<Map<string, ProjectFileInfo>>(new Map());

  /**
   * List all project files in the repo
   */
  const loadProjectFiles = useCallback(async () => {
    if (!repoPath) {
      setProjectFiles([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const files = await invoke<string[]>("list_story_files", { repoPath });
      setProjectFiles(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useOrgiiProjects] Failed to list files:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  /**
   * Extract projects from a specific file
   */
  const extractProjects = useCallback(
    async (filePath: string): Promise<ProjectFileInfo | null> => {
      // Check cache
      const cached = projectCache.current.get(filePath);
      if (cached) {
        return cached;
      }

      try {
        const info = await invoke<ProjectFileInfo>("extract_stories", {
          filePath,
        });

        // Cache the result (evict oldest if over limit)
        if (projectCache.current.size >= MAX_STORY_CACHE_SIZE) {
          const firstKey = projectCache.current.keys().next().value;
          if (firstKey) projectCache.current.delete(firstKey);
        }
        projectCache.current.set(filePath, info);

        return info;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          "[useOrgiiProjects] Failed to extract projects:",
          message
        );
        setError(message);
        return null;
      }
    },
    []
  );

  /**
   * Get projects for a specific component
   */
  const getComponentProjects = useCallback(
    async (componentFile: string): Promise<ProjectFileInfo | null> => {
      try {
        const info = await invoke<ProjectFileInfo | null>(
          "ui_index_get_component_stories",
          { componentFile }
        );

        if (info) {
          // Cache the result (evict oldest if over limit)
          if (projectCache.current.size >= MAX_STORY_CACHE_SIZE) {
            const firstKey = projectCache.current.keys().next().value;
            if (firstKey) projectCache.current.delete(firstKey);
          }
          projectCache.current.set(info.file, info);
        }

        return info;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[useOrgiiProjects] Failed to get projects:", message);
        return null;
      }
    },
    []
  );

  /**
   * Refresh the project file list
   */
  const refresh = useCallback(async () => {
    // Clear cache on refresh
    projectCache.current.clear();
    await loadProjectFiles();
  }, [loadProjectFiles]);

  // Load project files when repo changes
  useEffect(() => {
    if (repoPath) {
      projectCache.current.clear();
      loadProjectFiles();
    }
  }, [repoPath, loadProjectFiles]);

  return {
    projectFiles,
    loading,
    error,
    refresh,
    extractProjects,
    getComponentProjects,
    projectCache: projectCache.current,
  };
}

export default useOrgiiProjects;
