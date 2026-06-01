/**
 * useComponentCatalog - Hook for Component Catalog ("Storybook for AI")
 *
 * Provides:
 * - List all component definitions in a repo
 * - Lazy prop extraction (on-demand when component selected)
 * - Props caching for performance
 *
 * Performance Strategy:
 * - Initial list is fast (uses existing component index)
 * - Props are extracted lazily when user selects a component
 * - Props are cached after first extraction
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { repoPathAtom } from "@src/engines/SessionCore/workspace/atoms/sessionAtoms";

// ============================================
// Types
// ============================================

/** Component kind from Rust */
export type ComponentKind =
  | "function_def"
  | "arrow_def"
  | "class_def"
  | "jsx_usage"
  | "default_export"
  | "named_export"
  | "vue_def"
  | "svelte_def";

/** Component location from index */
export interface ComponentLocation {
  file: string;
  line: number;
  column: number;
  kind: ComponentKind;
  end_line?: number;
}

/** Prop type (simplified for frontend) */
export type PropType =
  | { type: "string" }
  | { type: "number" }
  | { type: "boolean" }
  | { type: "string_literal"; values: string[] }
  | { type: "array"; inner: PropType }
  | { type: "object"; props: PropInfo[] }
  | { type: "function"; params: string; return_type: string }
  | { type: "react_node" }
  | { type: "type_ref"; name: string }
  | { type: "unknown" };

/** Single prop definition */
export interface PropInfo {
  name: string;
  prop_type: PropType;
  type_annotation: string;
  required: boolean;
  default_value?: string;
  description?: string;
}

/** Full component details (returned by lazy extraction) */
export interface ComponentDetails {
  name: string;
  file: string;
  line: number;
  kind: ComponentKind;
  props: PropInfo[];
  props_type_name?: string;
  description?: string;
  extraction_time_ms: number;
}

/** Component catalog entry (name + location) */
export interface CatalogEntry {
  name: string;
  location: ComponentLocation;
}

/** Catalog state */
export interface ComponentCatalogState {
  /** Whether the catalog is loading */
  loading: boolean;
  /** List of all component definitions */
  components: CatalogEntry[];
  /** Error message if loading failed */
  error: string | null;
  /** Currently selected component's details (with props) */
  selectedDetails: ComponentDetails | null;
  /** Whether props are being extracted */
  extractingProps: boolean;
}

export interface UseComponentCatalogReturn extends ComponentCatalogState {
  /** Refresh the component list */
  refresh: () => Promise<void>;
  /** Select a component and extract its props (lazy) */
  selectComponent: (entry: CatalogEntry) => Promise<ComponentDetails | null>;
  /** Clear selection */
  clearSelection: () => void;
  /** Get cached props for a component (if already extracted) */
  getCachedProps: (file: string, name: string) => ComponentDetails | null;
}

// ============================================
// Hook
// ============================================

export interface UseComponentCatalogOptions {
  /** Optional repo path - if not provided, uses global repoPathAtom */
  repoPath?: string;
}

export function useComponentCatalog(
  options: UseComponentCatalogOptions = {}
): UseComponentCatalogReturn {
  const globalRepoPath = useAtomValue(repoPathAtom);
  const repoPath = options.repoPath || globalRepoPath;

  const [state, setState] = useState<ComponentCatalogState>({
    loading: false,
    components: [],
    error: null,
    selectedDetails: null,
    extractingProps: false,
  });

  // Cache for extracted props: key = `${file}:${name}` (capped to prevent memory growth)
  const MAX_PROPS_CACHE_SIZE = 100;
  const propsCache = useRef<Map<string, ComponentDetails>>(new Map());

  /**
   * Generate cache key for a component
   */
  const getCacheKey = useCallback(
    (file: string, name: string) => `${file}:${name}`,
    []
  );

  /**
   * Load all component definitions from the index
   * Auto-indexes the repo if not already indexed
   */
  const loadComponents = useCallback(async () => {
    if (!repoPath) {
      setState((prev) => ({
        ...prev,
        loading: false,
        components: [],
        error: "No repo selected",
      }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      // First check if repo is indexed
      const isIndexed = await invoke<boolean>("ui_index_is_repo_indexed", {
        repoPath,
      });

      // Auto-index if not indexed
      if (!isIndexed) {
        try {
          await invoke("ui_index_build_repo", { repoPath });
        } catch (indexError) {
          const indexMessage =
            indexError instanceof Error
              ? indexError.message
              : String(indexError);
          console.error("[ComponentCatalog] Auto-index failed:", indexMessage);
          setState((prev) => ({
            ...prev,
            loading: false,
            error: `Failed to index repo: ${indexMessage}`,
          }));
          return;
        }
      }

      // Now load components
      const result = await invoke<[string, ComponentLocation][]>(
        "ui_index_list_components",
        { repoPath }
      );

      const components: CatalogEntry[] = result.map(([name, location]) => ({
        name,
        location,
      }));

      setState((prev) => ({
        ...prev,
        loading: false,
        components,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[ComponentCatalog] Failed to load components:", message);
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, [repoPath]);

  /**
   * Extract props for a component (lazy, cached)
   */
  const selectComponent = useCallback(
    async (entry: CatalogEntry): Promise<ComponentDetails | null> => {
      const cacheKey = getCacheKey(entry.location.file, entry.name);

      // Check cache first
      const cached = propsCache.current.get(cacheKey);
      if (cached) {
        setState((prev) => ({ ...prev, selectedDetails: cached }));
        return cached;
      }

      // Extract props
      setState((prev) => ({ ...prev, extractingProps: true }));

      try {
        const details = await invoke<ComponentDetails>(
          "ui_index_extract_props",
          {
            filePath: entry.location.file,
            componentName: entry.name,
            line: entry.location.line,
            kind: entry.location.kind,
          }
        );

        // Cache the result (evict oldest if over limit)
        if (propsCache.current.size >= MAX_PROPS_CACHE_SIZE) {
          const firstKey = propsCache.current.keys().next().value;
          if (firstKey) propsCache.current.delete(firstKey);
        }
        propsCache.current.set(cacheKey, details);

        setState((prev) => ({
          ...prev,
          extractingProps: false,
          selectedDetails: details,
        }));

        return details;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[ComponentCatalog] Failed to extract props:", message);
        setState((prev) => ({
          ...prev,
          extractingProps: false,
          error: message,
        }));
        return null;
      }
    },
    [getCacheKey]
  );

  /**
   * Clear the current selection
   */
  const clearSelection = useCallback(() => {
    setState((prev) => ({ ...prev, selectedDetails: null }));
  }, []);

  /**
   * Get cached props (if already extracted)
   */
  const getCachedProps = useCallback(
    (file: string, name: string): ComponentDetails | null => {
      const cacheKey = getCacheKey(file, name);
      return propsCache.current.get(cacheKey) || null;
    },
    [getCacheKey]
  );

  /**
   * Refresh the component list
   */
  const refresh = useCallback(async () => {
    // Clear cache on refresh
    propsCache.current.clear();
    await loadComponents();
  }, [loadComponents]);

  // Load components when repo changes
  useEffect(() => {
    if (repoPath) {
      // Clear cache when repo changes
      propsCache.current.clear();
      // Defer to avoid synchronous setState in effect
      queueMicrotask(() => {
        loadComponents();
      });
    }
  }, [repoPath, loadComponents]);

  // Group components by directory for tree view
  const _componentsByDirectory = useMemo(() => {
    const grouped: Record<string, CatalogEntry[]> = {};

    for (const entry of state.components) {
      const dir = entry.location.file.split("/").slice(0, -1).join("/");
      if (!grouped[dir]) {
        grouped[dir] = [];
      }
      grouped[dir].push(entry);
    }

    return grouped;
  }, [state.components]);

  return {
    ...state,
    refresh,
    selectComponent,
    clearSelection,
    getCachedProps,
  };
}

export default useComponentCatalog;
