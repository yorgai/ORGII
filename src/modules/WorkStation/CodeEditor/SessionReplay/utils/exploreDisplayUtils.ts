import { getToolDisplayLabelFromRegistry } from "@src/util/ui/rendering/registryToolLabel";

import type { ExploreOperationEntry } from "../types";

export interface ExploreDisplayParts {
  primary: string;
  secondary?: string;
}

function getLspCheckedFileCount(op: ExploreOperationEntry): number {
  const files = new Set<string>();
  for (const file of op.files ?? []) {
    if (file.trim()) files.add(file.trim());
  }
  for (const result of op.results) {
    if (result.file.trim()) files.add(result.file.trim());
  }
  return files.size;
}

function getListDirTarget(op: ExploreOperationEntry): string | undefined {
  if (!op.directory) return undefined;
  const folderName = op.directory.split("/").filter(Boolean).pop();
  return folderName ? `${folderName}/` : op.directory;
}

function getCodeSearchPrimary(op: ExploreOperationEntry): string {
  const action = op.exploreAction?.toLowerCase();
  if (action === "grep") return "Grep";
  if (action === "glob") return "Glob";
  const functionName = op.event?.functionName ?? op.exploreType;
  return getToolDisplayLabelFromRegistry(functionName, action);
}

export function getExploreDisplayParts(
  op: ExploreOperationEntry
): ExploreDisplayParts {
  if (op.exploreType === "query_lsp") {
    const checkedFileCount = getLspCheckedFileCount(op);
    if (checkedFileCount > 0) {
      return {
        primary: getToolDisplayLabelFromRegistry("query_lsp"),
        secondary:
          checkedFileCount === 1 ? "1 file" : `${checkedFileCount} files`,
      };
    }
    return { primary: getToolDisplayLabelFromRegistry("query_lsp") };
  }

  if (op.exploreType === "glob") {
    return {
      primary: "Glob",
      secondary: op.query || undefined,
    };
  }

  if (op.exploreType === "list_dir") {
    return {
      primary: getToolDisplayLabelFromRegistry("list_dir"),
      secondary: getListDirTarget(op),
    };
  }

  if (op.exploreType === "cat") {
    const catMatch = op.query.match(/cat\s+(.+)/);
    if (catMatch) {
      const path = catMatch[1];
      return { primary: path.split("/").pop() || path };
    }
    return {
      primary:
        op.query ||
        getToolDisplayLabelFromRegistry(
          op.event?.functionName ?? op.exploreType
        ),
    };
  }

  if (op.exploreType === "code_search") {
    return {
      primary: getCodeSearchPrimary(op),
      secondary: op.query || undefined,
    };
  }

  const toolLabel = getToolDisplayLabelFromRegistry(
    op.event?.functionName ?? op.exploreType,
    op.exploreAction
  );
  return { primary: toolLabel, secondary: op.query || undefined };
}

/**
 * Primary label for an explore row in the simulator sidebar.
 *
 * Intentionally NOT localized — we use canonical English tool labels plus a
 * compact derived argument. This keeps rows consistent across all languages and
 * avoids leaking `t()` keys when locale entries are missing.
 */
export function getExploreDisplayName(op: ExploreOperationEntry): string {
  const parts = getExploreDisplayParts(op);
  return parts.secondary
    ? `${parts.primary} · ${parts.secondary}`
    : parts.primary;
}
