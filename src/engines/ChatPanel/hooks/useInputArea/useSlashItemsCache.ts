/**
 * useSlashItemsCache
 *
 * Shared hook that fetches and caches the full slash-menu item list:
 * built-in actions + installed skills + connected MCP tools.
 *
 * Both `useSlashCommand` (inline "/" menu) and `PinnedActionsBar` ("..."
 * panel) need identical fetch logic. This hook owns the one canonical copy
 * so any bug fix or feature (e.g. new skill filter) applies everywhere.
 *
 * Design:
 *  - The hook maintains a warm in-memory cache via `itemsCacheRef`.
 *  - `prefetch(query)` shows cached items immediately, then fires a fresh
 *    fetch in the background and updates `filteredItems`.
 *  - `fetchFresh()` always hits the backend; the caller can await it.
 *  - A `cancelledRef` prevents setState after unmount.
 */
import { invoke } from "@tauri-apps/api/core";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import {
  normalizeSkillDescription,
  resolveSkillGroup,
} from "@src/engines/ChatPanel/InputArea/components/SlashCommandPortal/slashItemUtils";
import { createLogger } from "@src/hooks/logger";
import { mergeInstalledSkills } from "@src/hooks/skills/installedSkillsMerge";
import { installedSkillsAtom } from "@src/store/skills/installedSkillsAtom";
import { type InstalledSkill, type SlashItem } from "@src/types/extensions";

const logger = createLogger("useSlashItemsCache");
const MAX_SLASH_ITEMS_SCOPE_CACHE_SIZE = 12;
const slashItemsCacheByScope = new Map<string, SlashItem[]>();

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getUniqueWorkspacePaths(paths?: string[]): string[] {
  const uniquePaths = new Set<string>();
  for (const path of paths ?? []) {
    const normalizedPath = normalizeWorkspacePath(path);
    if (normalizedPath) uniquePaths.add(normalizedPath);
  }
  return [...uniquePaths];
}

function isWorkspaceSkill(
  skill: InstalledSkill,
  workspacePaths: string[]
): boolean {
  const skillPath = normalizeWorkspacePath(skill.path);
  return workspacePaths.some((workspacePath) => {
    const workspacePrefix = `${workspacePath}/`;
    if (!skillPath.startsWith(workspacePrefix)) return false;
    const relativePath = skillPath.slice(workspacePrefix.length);
    return (
      relativePath.startsWith("skills/") ||
      /^\.[^/]+\/skills\//.test(relativePath)
    );
  });
}

function getSlashItemIdentity(item: SlashItem): string {
  return [
    item.category,
    item.name,
    item.description,
    item.source,
    item.acceptsArgs ? "args" : "no-args",
    item.skillName ?? "",
    item.skillPath ? normalizeWorkspacePath(item.skillPath) : "",
    item.skillScope ?? "",
    item.serverName ?? "",
  ].join("\0");
}

function slashItemsEqual(left: SlashItem[], right: SlashItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (item, index) =>
      getSlashItemIdentity(item) === getSlashItemIdentity(right[index])
  );
}

function setScopedSlashItemsCache(scopeKey: string, items: SlashItem[]): void {
  if (!slashItemsCacheByScope.has(scopeKey)) {
    while (slashItemsCacheByScope.size >= MAX_SLASH_ITEMS_SCOPE_CACHE_SIZE) {
      const oldestKey = slashItemsCacheByScope.keys().next().value;
      if (oldestKey === undefined) break;
      slashItemsCacheByScope.delete(oldestKey);
    }
  }
  slashItemsCacheByScope.set(scopeKey, items);
}

export interface UseSlashItemsCacheOptions {
  /**
   * Extra built-in SlashItems to prepend before skills + tools.
   * Each consumer passes a different subset of SLASH_ACTIONS.
   */
  builtinItems: SlashItem[];
  /** Repo/workspace scopes whose root `skills/` or hidden `.tool/skills/` roots should appear. */
  workspacePaths?: string[];
}

export interface UseSlashItemsCacheReturn {
  /** Current full item list for the active workspace scope. Renderers apply query filtering. */
  filteredItems: SlashItem[];
  /** True while a backend fetch is in flight. */
  loading: boolean;
  /**
   * Show cached items for `query` immediately, then kick off a fresh
   * backend fetch and update `filteredItems` when it resolves.
   */
  prefetch: (query: string) => void;
  /** Fire a fresh backend fetch unconditionally, update the full item list when it changed, and return it. */
  fetchFresh: () => Promise<SlashItem[]>;
}

export function useSlashItemsCache(
  options: UseSlashItemsCacheOptions
): UseSlashItemsCacheReturn {
  const { builtinItems, workspacePaths } = options;
  const setInstalledSkills = useSetAtom(installedSkillsAtom);
  const workspacePathsKey = getUniqueWorkspacePaths(workspacePaths).join("\0");

  const [filteredItems, setFilteredItems] = useState<SlashItem[]>([]);
  const [loading, setLoading] = useState(false);

  const itemsCacheRef = useRef<SlashItem[]>(
    slashItemsCacheByScope.get(workspacePathsKey) ?? []
  );
  const fetchSeqRef = useRef(0);
  const cancelledRef = useRef(false);
  // Keep a stable ref to builtinItems so fetch doesn't need it in deps
  const builtinItemsRef = useRef(builtinItems);
  builtinItemsRef.current = builtinItems;

  const doFetch = useCallback(async (): Promise<SlashItem[]> => {
    setLoading(true);
    try {
      const scopePaths = workspacePathsKey ? workspacePathsKey.split("\0") : [];
      const skillListTasks = [
        invoke<InstalledSkill[]>("skills_list", { workspacePath: null }),
        ...scopePaths.map((path) =>
          invoke<InstalledSkill[]>("skills_list", { workspacePath: path })
        ),
      ];
      const [skillResults, mcpServers] = await Promise.all([
        Promise.allSettled(skillListTasks),
        rpc.mcp.listServers({}).catch((err) => {
          logger.warn("Failed to list MCP servers for slash menu:", err);
          return [];
        }),
      ]);

      const rawSkills = mergeInstalledSkills(
        skillResults.flatMap((result) => {
          if (result.status === "fulfilled") return [result.value];
          logger.warn("Failed to list skills for slash menu:", result.reason);
          return [];
        })
      );
      const workspaceSkillRoots = scopePaths.map(normalizeWorkspacePath);
      logger.rateLimited("slash-skills-scan", 5_000, "slash skills fetched", {
        workspacePaths: workspaceSkillRoots,
        skillCount: rawSkills.length,
        workspaceSkillCount: rawSkills.filter((skill) =>
          isWorkspaceSkill(skill, workspaceSkillRoots)
        ).length,
        skillPaths: rawSkills.map((skill) => skill.path),
      });

      if (rawSkills.length > 0) {
        setInstalledSkills((current) =>
          mergeInstalledSkills([current, rawSkills])
        );
      }

      const skillItems: SlashItem[] = rawSkills
        .filter((s) => s.enabled)
        .map((s) => ({
          name: s.name,
          skillName: s.name,
          skillPath: s.path,
          description: normalizeSkillDescription(s),
          category: "skill" as const,
          source: resolveSkillGroup(s),
          acceptsArgs: false,
          skillScope: isWorkspaceSkill(s, workspaceSkillRoots)
            ? "workspace"
            : "user",
        }));

      const connectedServers = mcpServers.filter(
        (srv) => srv.status === "connected" && !srv.disabled
      );

      const toolItems: SlashItem[] = (
        await Promise.all(
          connectedServers.map((srv) =>
            rpc.mcp.listServerTools({ serverName: srv.name }).then(
              (tools) =>
                tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  category: "tool" as const,
                  source: srv.name,
                  acceptsArgs: true,
                  serverName: srv.name,
                })),
              (err) => {
                logger.warn(
                  `Failed to list tools for MCP server "${srv.name}":`,
                  err
                );
                return [] as SlashItem[];
              }
            )
          )
        )
      ).flat();

      const assembled: SlashItem[] = [
        ...builtinItemsRef.current,
        ...skillItems,
        ...toolItems,
      ];

      setScopedSlashItemsCache(workspacePathsKey, assembled);
      if (!cancelledRef.current) {
        itemsCacheRef.current = assembled;
      }
      return assembled;
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, [setInstalledSkills, workspacePathsKey]);

  const prefetch = useCallback(
    (_query: string) => {
      const currentFetchSeq = fetchSeqRef.current + 1;
      fetchSeqRef.current = currentFetchSeq;
      const cachedItems = slashItemsCacheByScope.get(workspacePathsKey) ?? [];
      if (cachedItems.length > 0) {
        itemsCacheRef.current = cachedItems;
        setFilteredItems(cachedItems);
      }
      doFetch().then((items) => {
        if (cancelledRef.current || fetchSeqRef.current !== currentFetchSeq) {
          return;
        }
        if (cachedItems.length === 0 || !slashItemsEqual(cachedItems, items)) {
          setFilteredItems(items);
        }
      });
    },
    [doFetch, workspacePathsKey]
  );

  const fetchFresh = useCallback(async (): Promise<SlashItem[]> => {
    const currentItems = itemsCacheRef.current;
    const items = await doFetch();
    if (!cancelledRef.current && !slashItemsEqual(currentItems, items)) {
      setFilteredItems(items);
    }
    return items;
  }, [doFetch]);

  // Warm the cache and refresh when the active repo/workspace scope changes.
  useEffect(() => {
    cancelledRef.current = false;
    const currentFetchSeq = fetchSeqRef.current + 1;
    fetchSeqRef.current = currentFetchSeq;
    const cachedItems = slashItemsCacheByScope.get(workspacePathsKey) ?? [];
    if (cachedItems.length > 0) {
      itemsCacheRef.current = cachedItems;
      setFilteredItems(cachedItems);
    }
    doFetch().then((items) => {
      if (cancelledRef.current || fetchSeqRef.current !== currentFetchSeq) {
        return;
      }
      if (cachedItems.length === 0 || !slashItemsEqual(cachedItems, items)) {
        setFilteredItems(items);
      }
    });
    return () => {
      cancelledRef.current = true;
    };
  }, [doFetch, workspacePathsKey]);

  return { filteredItems, loading, prefetch, fetchFresh };
}
