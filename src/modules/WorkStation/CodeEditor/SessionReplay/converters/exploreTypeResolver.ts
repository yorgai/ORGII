/**
 * Explore Type Resolver
 *
 * Single source of truth for mapping tool names to ExploreType.
 * Uses Rust's appSubtool ("explore") as the gate, then resolves
 * the specific ExploreType from the canonical tool name.
 */
import { APP_SUBTOOL } from "@src/engines/SessionCore/rendering/registry";
import {
  getAppSubtool,
  getCliUiCanonical,
} from "@src/engines/SessionCore/rendering/registry/initToolRegistry";

import { EXPLORE_TYPE, type ExploreType } from "../types";

const EXPLORE_TYPE_FOR_TOOL: Record<string, ExploreType> = {
  list_dir: EXPLORE_TYPE.LIST_DIR,
  list_directory: EXPLORE_TYPE.LIST_DIR,
  manage_workspace: EXPLORE_TYPE.MANAGE_WORKSPACE,
  query_lsp: EXPLORE_TYPE.QUERY_LSP,
  read_lints: EXPLORE_TYPE.QUERY_LSP,
  "Read Lints": EXPLORE_TYPE.QUERY_LSP,
  code_search: EXPLORE_TYPE.CODE_SEARCH,
  grep: EXPLORE_TYPE.CODE_SEARCH,
  ripgrep_raw_search: EXPLORE_TYPE.CODE_SEARCH,
  glob_file_search: EXPLORE_TYPE.GLOB,
  "Glob File": EXPLORE_TYPE.GLOB,
  GlobFile: EXPLORE_TYPE.GLOB,
  glob_file: EXPLORE_TYPE.GLOB,
  glob: EXPLORE_TYPE.GLOB,
  search_in_file: EXPLORE_TYPE.FILE_SEARCH,
  cat: EXPLORE_TYPE.CAT,
};

// `code_search` actions that return a flat file list instead of grep-style
// "path:line:content" rows. These must resolve to the `glob` ExploreType so
// the panel renders the file list branch (see SearchResultsContent.tsx).
const CODE_SEARCH_GLOB_ACTIONS: ReadonlySet<string> = new Set([
  "find_files",
  "glob",
]);

/**
 * Check if a tool should appear in the explore panel.
 * Includes explore, search, and glob subtool categories.
 */
export function isExplorePanelTool(functionName: string): boolean {
  const subtool = getAppSubtool(functionName);
  const canonical = getCliUiCanonical(functionName);
  return (
    subtool === APP_SUBTOOL.EXPLORE ||
    subtool === APP_SUBTOOL.SEARCH ||
    subtool === APP_SUBTOOL.GLOB ||
    canonical in EXPLORE_TYPE_FOR_TOOL ||
    functionName in EXPLORE_TYPE_FOR_TOOL
  );
}

/**
 * Resolve a tool's function name to its ExploreType.
 *
 * Checks the canonical UI name first (via Rust alias map), then raw name.
 * For multi-action tools (`code_search`), the `action` argument selects
 * the correct ExploreType so the panel routes file-list actions
 * (`find_files`, `glob`) to the glob renderer instead of the grep renderer.
 */
export function resolveExploreType(
  functionName: string,
  action?: string
): ExploreType {
  const canonical = getCliUiCanonical(functionName);

  if (
    canonical === EXPLORE_TYPE.CODE_SEARCH &&
    action &&
    CODE_SEARCH_GLOB_ACTIONS.has(action)
  ) {
    return EXPLORE_TYPE.GLOB;
  }

  return (
    EXPLORE_TYPE_FOR_TOOL[canonical] ??
    EXPLORE_TYPE_FOR_TOOL[functionName] ??
    EXPLORE_TYPE.CODE_SEARCH
  );
}
