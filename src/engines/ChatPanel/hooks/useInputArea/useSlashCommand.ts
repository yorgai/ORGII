/**
 * useSlashCommand
 *
 * Handles / slash command dropdown logic for the InputArea.
 * When the user types "/" at position 0 in an empty input, shows available
 * built-in slash actions in a filterable dropdown.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { rpc } from "@src/api/tauri/rpc";
import type { ComposerInputRef as TiptapInputRef } from "@src/components/ComposerInput";
import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import { useSessionId } from "@src/engines/SessionCore/hooks/session/useSessionId";
import { createLogger } from "@src/hooks/logger";
import { useSessionExecModeField } from "@src/hooks/session/useSessionPatch";
import { creatorDefaultExecModeAtom } from "@src/store/session/creatorDefaultExecModeAtom";
import {
  type InstalledSkill,
  SLASH_ACTIONS,
  type SlashItem,
} from "@src/types/extensions";
import { fuzzyMatch, fuzzyScore } from "@src/util/search/fuzzy";

const logger = createLogger("SlashCommand");

/**
 * Derive a human-readable group label from a skill's file path.
 *
 * Path patterns:
 *   ~/.cursor/skills/<name>/SKILL.md           → "Cursor Skills"
 *   ~/.orgii/skills/<name>/SKILL.md            → "Global Skills"
 *   /repo/path/.orgii/skills/<name>/SKILL.md   → repo folder name (last segment)
 *   /repo/path/.cursor/skills/<name>/SKILL.md  → repo folder name (last segment)
 * Falls back to the raw `source` field when the path doesn't match any pattern.
 */
function resolveSkillGroup(skill: InstalledSkill): string {
  const normalized = skill.path.replace(/\\/g, "/");
  const home = normalized.match(
    /^([/\\]Users\/[^/]+|\/home\/[^/]+|\/root)/
  )?.[1];

  if (home) {
    // ~/.cursor/skills → "Cursor Skills"
    if (normalized.startsWith(`${home}/.cursor/skills`)) return "Cursor Skills";
    // ~/.orgii/skills → "Global Skills"
    if (normalized.startsWith(`${home}/.orgii/skills`)) return "Global Skills";
  }

  // /repo/.orgii/skills or /repo/.cursor/skills → repo name
  const workspaceMatch = normalized.match(
    /^(.*?)\/(?:\.orgii|\.cursor)\/skills\//
  );
  if (workspaceMatch) {
    const repoPath = workspaceMatch[1];
    const segments = repoPath.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? skill.source;
  }

  return skill.source;
}

interface UseSlashCommandOptions {
  tiptapRef: RefObject<TiptapInputRef>;
  setShowSlashMenu: (show: boolean) => void;
  setSlashQuery: (query: string) => void;
  /**
   * When `true`, `/mode` always reads + writes `creatorDefaultExecModeAtom`
   * even if there is an active session in the route. Set by callers that
   * mount the input outside an in-session context (e.g. the
   * `SessionCreator` tiptap, where the user is configuring a *new*
   * session and `activeSessionIdAtom` is still pointing at the previous
   * session they were on). Defaults to `false` (the InputArea case).
   */
  creatorDefaultMode?: boolean;
}

export interface SlashCommandHandlers {
  handleSlashCommand: (query: string) => void;
  handleSlashCommandClose: () => void;
  handleSlashSelect: (item: SlashItem) => void;
  handleModeSelect: (mode: AgentExecMode) => void;
  currentMode: AgentExecMode;
  filteredItems: SlashItem[];
  slashLoading: boolean;
  /**
   * Fetch and filter items without opening the inline slash menu.
   * Use this when the + button portal needs fresh data but the inline
   * "/" menu must stay closed.
   */
  prefetchItems: (query: string) => void;
}

const BUILTIN_SLASH_ITEMS: SlashItem[] = [
  {
    name: SLASH_ACTIONS.OPEN_BROWSER,
    description: "Open browser automation controls",
    category: "action",
    source: "builtin",
    acceptsArgs: false,
  },
];

export function useSlashCommand(
  options: UseSlashCommandOptions
): SlashCommandHandlers {
  const {
    tiptapRef,
    setShowSlashMenu,
    setSlashQuery,
    creatorDefaultMode: forceCreatorDefault = false,
  } = options;

  // Mode source-of-truth follows the session: when the slash command is
  // typed inside a live chat the `/` mode picker reads + writes the
  // session row. The SessionCreator path explicitly opts out via
  // `creatorDefaultMode: true` because `useSessionId()` would otherwise
  // resolve to the previously-active session — which is NOT the
  // session being configured in the creator — and a `/mode` pick
  // there would silently rewrite the background session's pill.
  const { sessionId } = useSessionId();
  const isInSession = !forceCreatorDefault && Boolean(sessionId);
  const creatorDefaultMode = useAtomValue(creatorDefaultExecModeAtom);
  const setCreatorDefaultMode = useSetAtom(creatorDefaultExecModeAtom);
  const { agentExecMode: sessionMode, setMode: setSessionMode } =
    useSessionExecModeField(sessionId ?? "");
  const currentMode: AgentExecMode = isInSession
    ? ((sessionMode as AgentExecMode | undefined) ?? creatorDefaultMode)
    : creatorDefaultMode;
  const setMode = useCallback(
    (mode: AgentExecMode) => {
      if (isInSession) {
        // Fire-and-forget: optimistic write inside the hook repaints
        // the pill on the same frame, errors are surfaced via the
        // hook's own error state.
        void setSessionMode(mode);
      } else {
        setCreatorDefaultMode(mode);
      }
    },
    [isInSession, setSessionMode, setCreatorDefaultMode]
  );

  const [items, setItems] = useState<SlashItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<SlashItem[]>([]);
  const [slashLoading, setSlashLoading] = useState(false);
  const queryRef = useRef("");
  // Keep a ref to the latest fetched items so prefetchItems can
  // show cached data instantly while a fresh fetch is in flight.
  const itemsCacheRef = useRef<SlashItem[]>([]);
  // Flag set to true when the component unmounts so in-flight fetches do not
  // call setState on an unmounted component.
  const cancelledRef = useRef(false);

  const fetchItems = useCallback(async (): Promise<SlashItem[]> => {
    setSlashLoading(true);
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
        .filter((skill) => skill.enabled && skill.available)
        .map((skill) => ({
          name: skill.name,
          skillName: skill.name,
          // Omit placeholder descriptions that convey no information
          description:
            skill.description && skill.description !== "---"
              ? skill.description
              : "",
          category: "skill" as const,
          source: resolveSkillGroup(skill),
          acceptsArgs: false,
        }));

      const connectedServers = mcpServers.filter(
        (server) => server.status === "connected" && !server.disabled
      );

      const toolItems: SlashItem[] = (
        await Promise.all(
          connectedServers.map((server) =>
            rpc.mcp.listServerTools({ serverName: server.name }).then(
              (tools) =>
                tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  category: "tool" as const,
                  source: server.name,
                  acceptsArgs: true,
                  serverName: server.name,
                })),
              (err) => {
                logger.warn(
                  `Failed to list tools for MCP server "${server.name}":`,
                  err
                );
                return [] as SlashItem[];
              }
            )
          )
        )
      ).flat();

      const allItems: SlashItem[] = [
        ...BUILTIN_SLASH_ITEMS,
        ...skillItems,
        ...toolItems,
      ];
      if (!cancelledRef.current) {
        setItems(allItems);
        itemsCacheRef.current = allItems;
      }
      return allItems;
    } finally {
      if (!cancelledRef.current) {
        setSlashLoading(false);
      }
    }
  }, []);

  const filterItems = useCallback(
    (query: string, allItems: SlashItem[]): SlashItem[] => {
      if (!query) return allItems;
      return allItems
        .filter(
          (item) =>
            fuzzyMatch(query, item.name) || fuzzyMatch(query, item.description)
        )
        .sort(
          (itemA, itemB) =>
            fuzzyScore(query, itemB.name) - fuzzyScore(query, itemA.name)
        );
    },
    []
  );

  const prefetchItems = useCallback(
    (query: string) => {
      // Show cached items immediately so the menu isn't empty on first open.
      if (itemsCacheRef.current.length > 0) {
        setFilteredItems(filterItems(query, itemsCacheRef.current));
      }
      // Then fetch fresh data and update.
      fetchItems().then((allItems) => {
        setFilteredItems(filterItems(query, allItems));
      });
    },
    [fetchItems, filterItems]
  );

  // Warm the cache on mount so the first + menu open is instant.
  useEffect(() => {
    cancelledRef.current = false;
    fetchItems().then((allItems) => {
      // Only seed filteredItems if no query is active yet.
      if (!cancelledRef.current && !queryRef.current) {
        setFilteredItems(allItems);
      }
    });
    return () => {
      cancelledRef.current = true;
    };
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSlashCommand = useCallback(
    (query: string) => {
      queryRef.current = query;
      setSlashQuery(query);
      setShowSlashMenu(true);
      prefetchItems(query);
    },
    [setShowSlashMenu, setSlashQuery, prefetchItems]
  );

  const handleSlashCommandClose = useCallback(() => {
    setShowSlashMenu(false);
    setSlashQuery("");
    queryRef.current = "";
  }, [setShowSlashMenu, setSlashQuery]);

  const handleSlashSelect = useCallback(
    (item: SlashItem) => {
      if (!tiptapRef.current) return;

      if (item.category === "action") {
        if (item.name === SLASH_ACTIONS.OPEN_BROWSER) {
          tiptapRef.current.clear();
          setShowSlashMenu(false);
          setSlashQuery("");
          queryRef.current = "";
          // orgii:open-browser is handled by useOpenUrlInBrowser (always
          // mounted in BrowserProvider). It opens a blank tab and navigates
          // to the browser route without any BrowserLayout mount dependency.
          window.dispatchEvent(new CustomEvent("orgii:open-browser"));
          return;
        }
      }

      if (item.category === "skill") {
        // Clear the "/" the user typed, then insert a highlighted skill pill.
        // filePath is stored as "/<skillName>" so serializePillNode produces
        // `name [skill:/<skillName>]` and useSubmitMessage expands it to
        // `/<skillName>` for the Rust backend's skill expansion.
        const skillToken = `/${item.skillName ?? item.name}`;
        tiptapRef.current.clear();
        tiptapRef.current.insertFilePill(skillToken, false, "skill", item.name);
        tiptapRef.current.focus();
        setShowSlashMenu(false);
        setSlashQuery("");
        queryRef.current = "";
        return;
      }

      if (item.category === "tool" && item.serverName) {
        // Insert /mcp__<server>__<tool> so the user can append arguments before sending.
        const serverSlug = item.serverName.replace(/-/g, "_");
        tiptapRef.current.setContent(`/mcp__${serverSlug}__${item.name} `);
        tiptapRef.current.focus();
        setShowSlashMenu(false);
        setSlashQuery("");
        queryRef.current = "";
        return;
      }

      tiptapRef.current.setContent(`/${item.name} `);
      tiptapRef.current.focus();

      setShowSlashMenu(false);
      setSlashQuery("");
      queryRef.current = "";
    },
    [tiptapRef, setShowSlashMenu, setSlashQuery]
  );

  // Update filtered items when items change
  useEffect(() => {
    if (items.length > 0) {
      setFilteredItems(filterItems(queryRef.current, items));
    }
  }, [items, filterItems]);

  const handleModeSelect = useCallback(
    (mode: AgentExecMode) => {
      setMode(mode);
      setShowSlashMenu(false);
      setSlashQuery("");
      queryRef.current = "";
      // Clear the "/" from the editor
      if (tiptapRef.current) {
        tiptapRef.current.clear();
      }
    },
    [setMode, setShowSlashMenu, setSlashQuery, tiptapRef]
  );

  return {
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    filteredItems,
    slashLoading,
    prefetchItems,
  };
}
