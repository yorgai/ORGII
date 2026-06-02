/**
 * TabBarPlusMenu
 *
 * Trailing `+` button for the unified workstation tab bar. Opens a tiny
 * palette that combines a single smart search field with a small set of
 * quick-action items. Each action adds (or activates) a tab in
 * `mainPane`; `AppShell` then swaps in the matching host content via
 * `activeHostAtom`.
 *
 * Smart search input ("Open file, URL ?"):
 *   - Heuristic-routed by {@link classifyPlusMenuQuery}:
 *     - **file-like** (leading `.` or `/`, looks like `name.ext`,
 *       contains path separators) → `openEditorSpotlight(query)` so the
 *       user lands in the global file palette with the query prefilled.
 *     - **otherwise** (URL, domain, search keywords) →
 *       `requestNewBrowserSession({ url })`. The Browser host runs the
 *       value through `normalizeBrowserInput`, so bare keywords become a
 *       search-engine URL and partial domains gain a scheme.
 *   - Submit with Enter; Escape closes the menu. Empty submit is a no-op.
 *
 * Menu items:
 *   - `"newBrowserTab"` → `requestNewBrowserSession({})` for a blank
 *     regular session.
 *   - `"newPrivateBrowserTab"` → `requestNewBrowserSession({ isPrivate:
 *     true })` for an incognito session. Browser-only semantics — only
 *     rendered when this item is included.
 *   - `"workItems"` → open the workspace-scope Work Items index tab.
 *   - `"projects"` → open the workspace-scope Projects dashboard tab.
 *
 * Surfaces:
 *   - **All Tabs** mode renders the full palette with search + 3 items
 *     (regular browser tab / work items / projects).
 *   - **Browser** mode renders a Browser-focused palette: same search,
 *     plus `newBrowserTab` and `newPrivateBrowserTab`.
 *   - Other modes (Code / Data / Project) do **not** show a `+` at all.
 *
 * Keyboard: ⌘T (`new_tab`) opens whichever instance of this menu is
 * currently mounted. The global keydown listener dispatches
 * `workstation-new-tab` from any `/orgii/workstation*` route (see
 * `useTabShortcuts.handleGoToCreateSession`); we listen for it here so
 * the shortcut is owned exclusively by the `+` menu — host-specific
 * "new tab" semantics (Code file palette, Database add-connection,
 * Project create-project) are intentionally NOT bound to ⌘T.
 */
import { useSetAtom } from "jotai";
import { Box, Globe, ListTodo, Plus, Search, ShieldOff } from "lucide-react";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Dropdown from "@src/components/Dropdown";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_SEARCH,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { useTauriSelectAllShortcut } from "@src/hooks/keyboard";
import { TabBarTrailingIconButton } from "@src/modules/WorkStation/shared/TabBar/components/TabBarTrailingIconButton";
import { openEditorSpotlight } from "@src/scaffold/GlobalSpotlight/openSpotlight";
import { CODE_EDITOR_TOUR_TARGETS } from "@src/scaffold/Tutorials/codeEditorTourConfig";
import {
  STORY_ORG_SCOPE,
  createProjectDashboardTab,
  createProjectWorkItemsIndexTab,
  openTab as openTabMutation,
  requestNewBrowserSessionAtom,
  workstationLayoutAtom,
} from "@src/store/workstation";
import type { WorkStationTab } from "@src/store/workstation/tabs";

import { classifyPlusMenuQuery } from "./classifyQuery";

const WORKSTATION_NEW_TAB_EVENT = "workstation-new-tab";

export type TabBarPlusMenuItem =
  | "newBrowserTab"
  | "newPrivateBrowserTab"
  | "workItems"
  | "projects";

const DEFAULT_ITEMS: readonly TabBarPlusMenuItem[] = [
  "newBrowserTab",
  "newPrivateBrowserTab",
  "workItems",
  "projects",
];

const KNOWN_ITEMS: readonly TabBarPlusMenuItem[] = [
  "newBrowserTab",
  "newPrivateBrowserTab",
  "workItems",
  "projects",
];

export interface TabBarPlusMenuProps {
  /** Menu items to render. Defaults to the full All-Tabs palette. */
  items?: readonly TabBarPlusMenuItem[];
}

interface MenuItemContentProps {
  icon: React.ReactNode;
  label: React.ReactNode;
}

function MenuItemContent({ icon, label }: MenuItemContentProps) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

const TabBarPlusMenuComponent: React.FC<TabBarPlusMenuProps> = ({
  items = DEFAULT_ITEMS,
}) => {
  const { t } = useTranslation("navigation");
  const requestNewBrowserSession = useSetAtom(requestNewBrowserSessionAtom);
  const setLayout = useSetAtom(workstationLayoutAtom);
  const [menuVisible, setMenuVisible] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tauriSelectAll = useTauriSelectAllShortcut();

  const close = useCallback(() => {
    setMenuVisible(false);
    setQuery("");
  }, []);

  // Add (or activate) a tab in the single `mainPane` pool. AppShell's
  // `activeHostAtom` will then swap the visible host content to match.
  const openTabInMainPane = useCallback(
    (tab: WorkStationTab) => {
      setLayout((prev) => {
        if (!prev?.mainPane) return prev;
        return { ...prev, mainPane: openTabMutation(prev.mainPane, tab) };
      });
    },
    [setLayout]
  );

  const handleNewBrowserTab = useCallback(() => {
    requestNewBrowserSession({});
    close();
  }, [close, requestNewBrowserSession]);

  const handleNewPrivateBrowserTab = useCallback(() => {
    requestNewBrowserSession({ isPrivate: true });
    close();
  }, [close, requestNewBrowserSession]);

  const handleOpenWorkItems = useCallback(() => {
    openTabInMainPane(
      createProjectWorkItemsIndexTab({ orgScope: STORY_ORG_SCOPE.ALL })
    );
    close();
  }, [close, openTabInMainPane]);

  const handleOpenProjects = useCallback(() => {
    openTabInMainPane(
      createProjectDashboardTab({ orgScope: STORY_ORG_SCOPE.ALL })
    );
    close();
  }, [close, openTabInMainPane]);

  // Submit the search field. Routes to the file palette for file-like
  // input, otherwise opens a Browser tab pointed at the (normalized)
  // URL or search query.
  const handleSubmitQuery = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const kind = classifyPlusMenuQuery(trimmed);
    if (kind === "file") {
      // `openEditorSpotlight` prefills the global file palette so the
      // user can refine the match without retyping.
      openEditorSpotlight(trimmed);
    } else {
      requestNewBrowserSession({ url: trimmed });
    }
    close();
  }, [close, query, requestNewBrowserSession]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSubmitQuery();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      tauriSelectAll(event);
    },
    [close, handleSubmitQuery, tauriSelectAll]
  );

  // ⌘T (`new_tab`) is exclusively bound to opening this menu. Whether the
  // bridge route or the dock filter route triggered it, the rule is the
  // same: toggle the palette open. Only one TabBarPlusMenu is mounted at
  // a time per surface (All Tabs vs Browser), so there is no double-fire.
  useEffect(() => {
    const handler = () => setMenuVisible((open) => !open);
    window.addEventListener(WORKSTATION_NEW_TAB_EVENT, handler);
    return () => {
      window.removeEventListener(WORKSTATION_NEW_TAB_EVENT, handler);
    };
  }, []);

  // Autofocus the search field when the dropdown opens. We defer to the
  // next frame so the popup's mount/positioning has settled and Dropdown
  // hasn't reclaimed focus.
  useEffect(() => {
    if (!menuVisible) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [menuVisible]);

  const triggerLabel = t("workstation.plusMenu.title");
  const triggerTooltip = (
    <KeyboardShortcutTooltipContent
      label={triggerLabel}
      shortcut={getShortcutKeys("new_tab")}
    />
  );

  const visibleItems = useMemo(
    () => items.filter((item) => KNOWN_ITEMS.includes(item)),
    [items]
  );

  const droplist = (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelWithHeaderBase} ${DROPDOWN_WIDTHS.wideMenuClass}`}
    >
      <div className={DROPDOWN_CLASSES.searchContainer}>
        <Search
          size={DROPDOWN_SEARCH.iconSize}
          className="flex-shrink-0 text-text-3"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t("workstation.plusMenu.searchPlaceholder")}
          className={DROPDOWN_CLASSES.searchInput}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      <div className={DROPDOWN_CLASSES.itemsColumnBelowSearch}>
        {visibleItems.includes("newBrowserTab") && (
          <button
            type="button"
            onClick={handleNewBrowserTab}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <MenuItemContent
              icon={<Globe size={HEADER_ICON_SIZE.sm} />}
              label={t("workstation.plusMenu.newBrowserTab")}
            />
          </button>
        )}

        {visibleItems.includes("newPrivateBrowserTab") && (
          <button
            type="button"
            onClick={handleNewPrivateBrowserTab}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <MenuItemContent
              icon={<ShieldOff size={HEADER_ICON_SIZE.sm} />}
              label={t("workstation.plusMenu.newPrivateBrowserTab")}
            />
          </button>
        )}

        {visibleItems.includes("workItems") && (
          <button
            type="button"
            onClick={handleOpenWorkItems}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <MenuItemContent
              icon={<ListTodo size={HEADER_ICON_SIZE.sm} />}
              label={t("workstation.plusMenu.workItems")}
            />
          </button>
        )}

        {visibleItems.includes("projects") && (
          <button
            type="button"
            onClick={handleOpenProjects}
            className={DROPDOWN_CLASSES.menuActionItem}
          >
            <MenuItemContent
              icon={<Box size={HEADER_ICON_SIZE.sm} />}
              label={t("workstation.plusMenu.projects")}
            />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <Dropdown
      droplist={droplist}
      position="bottom-end"
      trigger="click"
      popupVisible={menuVisible}
      onVisibleChange={setMenuVisible}
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <Tooltip
        content={triggerTooltip}
        position="bottom-end"
        mouseEnterDelay={200}
        framedPanel
        // Suppress the shortcut tooltip while the dropdown is open — the
        // palette itself is the user's focus, the trigger hint is noise.
        disabled={menuVisible}
      >
        <span
          className="inline-flex"
          data-tour-target={CODE_EDITOR_TOUR_TARGETS.plusMenu}
        >
          <TabBarTrailingIconButton
            title={triggerLabel}
            nativeTitle={false}
            active={menuVisible}
            className="flex-shrink-0"
          >
            <Plus size={HEADER_ICON_SIZE.md} strokeWidth={2} />
          </TabBarTrailingIconButton>
        </span>
      </Tooltip>
    </Dropdown>
  );
};

export const TabBarPlusMenu = memo(TabBarPlusMenuComponent);

TabBarPlusMenu.displayName = "TabBarPlusMenu";
