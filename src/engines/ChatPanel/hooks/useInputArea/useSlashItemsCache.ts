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
import { useCallback, useEffect, useRef, useState } from "react";

import { rpc } from "@src/api/tauri/rpc";
import {
  normalizeSkillDescription,
  resolveSkillGroup,
} from "@src/engines/ChatPanel/InputArea/components/SlashCommandPortal/slashItemUtils";
import { createLogger } from "@src/hooks/logger";
import { type InstalledSkill, type SlashItem } from "@src/types/extensions";
import { fuzzyMatch, fuzzyScore } from "@src/util/search/fuzzy";

const logger = createLogger("useSlashItemsCache");

export interface UseSlashItemsCacheOptions {
  /**
   * Extra built-in SlashItems to prepend before skills + tools.
   * Each consumer passes a different subset of SLASH_ACTIONS.
   */
  builtinItems: SlashItem[];
}

export interface UseSlashItemsCacheReturn {
  /** Current filtered item list (matches the latest query). */
  filteredItems: SlashItem[];
  /** True while a backend fetch is in flight. */
  loading: boolean;
  /**
   * Show cached items for `query` immediately, then kick off a fresh
   * backend fetch and update `filteredItems` when it resolves.
   */
  prefetch: (query: string) => void;
  /**
   * Fire a fresh backend fetch unconditionally and return the full list.
   * Does not update `filteredItems` — use `prefetch` for that.
   */
  fetchFresh: () => Promise<SlashItem[]>;
}

export function useSlashItemsCache(
  options: UseSlashItemsCacheOptions
): UseSlashItemsCacheReturn {
  const { builtinItems } = options;

  const [filteredItems, setFilteredItems] = useState<SlashItem[]>([]);
  const [loading, setLoading] = useState(false);

  const itemsCacheRef = useRef<SlashItem[]>([]);
  const cancelledRef = useRef(false);
  // Keep a stable ref to builtinItems so fetch doesn't need it in deps
  const builtinItemsRef = useRef(builtinItems);
  builtinItemsRef.current = builtinItems;

  const doFetch = useCallback(async (): Promise<SlashItem[]> => {
    setLoading(true);
    try {
      const [rawSkills, mcpServers] = await Promise.all([
        invoke<InstalledSkill[]>("skills_list", { workspacePath: null }).catch(
          (err) => {
            logger.warn("Failed to list skills for slash menu:", err);
            return [] as InstalledSkill[];
          }
        ),
        rpc.mcp.listServers({}).catch((err) => {
          logger.warn("Failed to list MCP servers for slash menu:", err);
          return [];
        }),
      ]);

      const skillItems: SlashItem[] = rawSkills
        .filter((s) => s.enabled && s.available)
        .map((s) => ({
          name: s.name,
          skillName: s.name,
          description: normalizeSkillDescription(s),
          category: "skill" as const,
          source: resolveSkillGroup(s),
          acceptsArgs: false,
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

      if (!cancelledRef.current) {
        itemsCacheRef.current = assembled;
      }
      return assembled;
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const filterItems = useCallback(
    (query: string, items: SlashItem[]): SlashItem[] => {
      if (!query) return items;
      return items
        .filter(
          (item) =>
            fuzzyMatch(query, item.name) || fuzzyMatch(query, item.description)
        )
        .sort((a, b) => fuzzyScore(query, b.name) - fuzzyScore(query, a.name));
    },
    []
  );

  const prefetch = useCallback(
    (query: string) => {
      if (itemsCacheRef.current.length > 0) {
        setFilteredItems(filterItems(query, itemsCacheRef.current));
      }
      doFetch().then((items) => {
        if (!cancelledRef.current) {
          setFilteredItems(filterItems(query, items));
        }
      });
    },
    [doFetch, filterItems]
  );

  const fetchFresh = useCallback((): Promise<SlashItem[]> => {
    return doFetch();
  }, [doFetch]);

  // Warm the cache on mount so the first open is instant.
  useEffect(() => {
    cancelledRef.current = false;
    doFetch().then((items) => {
      if (!cancelledRef.current) {
        setFilteredItems(items);
      }
    });
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { filteredItems, loading, prefetch, fetchFresh };
}
