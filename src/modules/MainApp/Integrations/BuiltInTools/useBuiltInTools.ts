/**
 * useBuiltInTools
 *
 * Drives the "Integrations → Built-in Tools" page (global view across the app):
 *   - Lists all built-in tools, including internal read-only plumbing tools
 *     (MCP tools intentionally excluded; they have their own "MCP" integrations
 *     entry, and per-tool toggling lives on each agent's Tools tab).
 *   - Exposes per-agent enable/disable for user-configurable tools.
 *     Custom agents own their tool selection via `AgentDefinition.tools`
 *     (allowlist + blacklists) and are not represented here.
 *
 * The OS/SDE config slice + native permission detection + toggle plumbing is shared
 * with AgentOrgs' scoped Tools tab via `useToolsSharedConfig`.
 */
import { useCallback, useMemo, useState } from "react";

import { matchesTableSearchText } from "@src/util/search/tableSearchMatch";

import {
  ALL_CATEGORY_KEY,
  TOOL_CATEGORY_ORDER,
  toolCategoryLabel,
} from "./config";
import {
  DEFAULT_SIMULATOR_APP,
  type RawToolInfo,
  type ToolRow,
  type ToolSource,
  parseHumanToolKey,
  parseSimulatorApp,
} from "./types";
import { useToolsSharedConfig } from "./useToolsSharedConfig";

export function useBuiltInTools() {
  const shared = useToolsSharedConfig();
  const {
    rawTools,
    toolsLoading,
    refreshTools,
    osLoaded,
    osDisabled,
    toggleOS,
    sdeLoaded,
    sdeDisabled,
    toggleSde,
  } = shared;

  const [activeFilter, setActiveFilter] = useState(ALL_CATEGORY_KEY);
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = useCallback(() => {
    refreshTools();
  }, [refreshTools]);

  const categoryLabel = useCallback(
    (cat: string) => toolCategoryLabel(cat),
    []
  );

  const allTools = useMemo<ToolRow[]>(() => {
    return (
      rawTools
        // MCP tools have their own Integrations entry ("MCP" in the sidebar)
        // with per-server install/connect UX; surfacing them again in the
        // built-in grid would duplicate a tool's only enable/disable
        // affordance and push 30+ rows of `mcp__server__tool` into the type
        // filter. Per-tool toggling for MCP lives on each agent's tools tab.
        .filter((raw: RawToolInfo) => raw.source !== "mcp")
        .map((raw: RawToolInfo) => ({
          name: raw.name,
          description: raw.description,
          descriptionDetail:
            raw.description_detail != null && raw.description_detail !== ""
              ? raw.description_detail
              : null,
          iconId:
            raw.icon_id != null && raw.icon_id !== "" ? raw.icon_id : null,
          category: raw.category || "general",
          source: "builtin" as ToolSource,
          internal: Boolean(raw.hidden),
          supportedAgents: raw.hidden
            ? []
            : (raw.supported_agents ?? ["os", "sde"]),
          simulatorApp:
            parseSimulatorApp(raw.simulatorApp) ?? DEFAULT_SIMULATOR_APP,
          humanToolKey: parseHumanToolKey(raw.humanToolKey),
          actions: raw.actions ?? [],
        }))
        .sort((rowA, rowB) => {
          const idxA = TOOL_CATEGORY_ORDER.indexOf(
            rowA.category as (typeof TOOL_CATEGORY_ORDER)[number]
          );
          const idxB = TOOL_CATEGORY_ORDER.indexOf(
            rowB.category as (typeof TOOL_CATEGORY_ORDER)[number]
          );
          const catDiff =
            (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
          if (catDiff !== 0) return catDiff;
          return rowA.name.localeCompare(rowB.name);
        })
    );
  }, [rawTools]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of allTools) {
      counts.set(tool.category, (counts.get(tool.category) ?? 0) + 1);
    }
    return counts;
  }, [allTools]);

  const filterTabs = useMemo(() => {
    const cats = TOOL_CATEGORY_ORDER.filter((cat) => categoryCounts.has(cat));
    const extraCats = [...categoryCounts.keys()]
      .filter(
        (cat) =>
          !TOOL_CATEGORY_ORDER.includes(
            cat as (typeof TOOL_CATEGORY_ORDER)[number]
          )
      )
      .sort();

    return [
      { key: ALL_CATEGORY_KEY, label: `All (${allTools.length})` },
      ...[...cats, ...extraCats].map((cat) => ({
        key: cat,
        label: `${toolCategoryLabel(cat)} (${categoryCounts.get(cat)})`,
      })),
    ];
  }, [allTools.length, categoryCounts]);

  const filteredTools = useMemo(() => {
    return allTools.filter((tool) => {
      if (activeFilter !== ALL_CATEGORY_KEY && tool.category !== activeFilter)
        return false;
      if (
        searchQuery &&
        !matchesTableSearchText(tool.name, searchQuery) &&
        !matchesTableSearchText(tool.description, searchQuery) &&
        !(
          tool.descriptionDetail != null &&
          matchesTableSearchText(tool.descriptionDetail, searchQuery)
        )
      ) {
        return false;
      }
      return true;
    });
  }, [allTools, activeFilter, searchQuery]);

  const configLoading = !osLoaded || !sdeLoaded;

  return {
    allTools,
    filteredTools,
    filterTabs,
    activeFilter,
    setActiveFilter,
    searchQuery,
    setSearchQuery,
    osDisabled,
    sdeDisabled,
    toggleOS,
    toggleSde,
    categoryLabel,
    configLoading,
    toolsListLoading: toolsLoading,
    toolCount: allTools.length,
    refresh,
  };
}

export type UseBuiltInToolsReturn = ReturnType<typeof useBuiltInTools>;
