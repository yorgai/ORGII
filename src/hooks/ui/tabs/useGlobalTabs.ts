/**
 * useGlobalTabs Hooks
 *
 * Focused hooks for accessing specific categories of global tabs.
 * Each hook only subscribes to the atoms it needs, preventing unnecessary re-renders.
 *
 * PERFORMANCE: Use the focused hooks (useGlobalBrowserTabs, useGlobalTerminalTabs, etc.)
 * instead of the combined useGlobalTabs hook when you only need a specific category.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import { useMemo } from "react";

import {
  addBrowserTabAtom,
  addDocumentFileAtom,
  addEditorRepoAtom,
  addShortcutAtom,
  addTerminalSessionAtom,
  addWorkspaceSessionAtom,
  removeBrowserTabAtom,
  removeDocumentFileAtom,
  removeEditorRepoAtom,
  removeShortcutAtom,
  removeTerminalSessionAtom,
  removeWorkspaceSessionAtom,
  setActiveBrowserTabAtom,
  setActiveDocumentFileAtom,
  setActiveEditorRepoAtom,
  setActiveShortcutAtom,
  setActiveTerminalSessionAtom,
  setActiveWorkspaceSessionAtom,
  updateBrowserTabAtom,
} from "@src/store/ui/globalTabsActions";
import {
  activeBrowserTabAtom,
  activeDocumentFileAtom,
  activeShortcutAtom,
  activeTerminalSessionAtom,
  activeWorkspaceSessionAtom,
  globalTabsAtom,
  tabCountsAtom,
} from "@src/store/ui/globalTabsAtom";
import type {
  BrowserTab,
  DocumentFile,
  EditorRepo,
  ShortcutItem,
  TerminalSession,
  WorkspaceSession,
} from "@src/store/ui/globalTabsTypes";
import { activeEditorRepoAtom } from "@src/store/workstation/tabs";

// ============================================
// Selector Atoms (created once, reused)
// ============================================

const browserTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.browser);
const terminalTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.terminal);
const editorTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.editor);
const filesTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.files);
const sessionsTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.sessions);
const shortcutsTabsAtom = selectAtom(globalTabsAtom, (tabs) => tabs.shortcuts);

// ============================================
// Focused Hooks - Use these for better performance
// ============================================

/**
 * Hook for browser tabs only.
 * Only re-renders when browser tabs change.
 */
export const useGlobalBrowserTabs = () => {
  const browserTabs = useAtomValue(browserTabsAtom);
  const activeBrowser = useAtomValue(activeBrowserTabAtom);
  const addBrowserTab = useSetAtom(addBrowserTabAtom);
  const removeBrowserTab = useSetAtom(removeBrowserTabAtom);
  const setActiveBrowserTab = useSetAtom(setActiveBrowserTabAtom);
  const updateBrowserTab = useSetAtom(updateBrowserTabAtom);

  return {
    browserTabs,
    activeBrowser,
    addBrowserTab,
    removeBrowserTab,
    setActiveBrowserTab,
    updateBrowserTab,
  };
};

/**
 * Hook for terminal sessions only.
 * Only re-renders when terminal sessions change.
 */
export const useGlobalTerminalTabs = () => {
  const terminalTabs = useAtomValue(terminalTabsAtom);
  const activeTerminal = useAtomValue(activeTerminalSessionAtom);
  const addTerminalSession = useSetAtom(addTerminalSessionAtom);
  const removeTerminalSession = useSetAtom(removeTerminalSessionAtom);
  const setActiveTerminalSession = useSetAtom(setActiveTerminalSessionAtom);

  return {
    terminalTabs,
    activeTerminal,
    addTerminalSession,
    removeTerminalSession,
    setActiveTerminalSession,
  };
};

/**
 * Hook for editor repos only.
 * Only re-renders when editor repos change.
 */
export const useGlobalEditorTabs = () => {
  const editorTabs = useAtomValue(editorTabsAtom);
  const activeEditor = useAtomValue(activeEditorRepoAtom);
  const addEditorRepo = useSetAtom(addEditorRepoAtom);
  const removeEditorRepo = useSetAtom(removeEditorRepoAtom);
  const setActiveEditorRepo = useSetAtom(setActiveEditorRepoAtom);

  return {
    editorTabs,
    activeEditor,
    addEditorRepo,
    removeEditorRepo,
    setActiveEditorRepo,
  };
};

/**
 * Hook for document files only.
 * Only re-renders when document files change.
 */
export const useGlobalDocumentTabs = () => {
  const documentTabs = useAtomValue(filesTabsAtom);
  const activeDocument = useAtomValue(activeDocumentFileAtom);
  const addDocumentFile = useSetAtom(addDocumentFileAtom);
  const removeDocumentFile = useSetAtom(removeDocumentFileAtom);
  const setActiveDocumentFile = useSetAtom(setActiveDocumentFileAtom);

  return {
    documentTabs,
    activeDocument,
    addDocumentFile,
    removeDocumentFile,
    setActiveDocumentFile,
  };
};

/**
 * Hook for workspace sessions only.
 * Only re-renders when workspace sessions change.
 */
export const useGlobalSessionTabs = () => {
  const sessionTabs = useAtomValue(sessionsTabsAtom);
  const activeSession = useAtomValue(activeWorkspaceSessionAtom);
  const addWorkspaceSession = useSetAtom(addWorkspaceSessionAtom);
  const removeWorkspaceSession = useSetAtom(removeWorkspaceSessionAtom);
  const setActiveWorkspaceSession = useSetAtom(setActiveWorkspaceSessionAtom);

  return {
    sessionTabs,
    activeSession,
    addWorkspaceSession,
    removeWorkspaceSession,
    setActiveWorkspaceSession,
  };
};

/**
 * Hook for shortcuts only.
 * Only re-renders when shortcuts change.
 */
export const useGlobalShortcutTabs = () => {
  const shortcutTabs = useAtomValue(shortcutsTabsAtom);
  const activeShortcut = useAtomValue(activeShortcutAtom);
  const addShortcut = useSetAtom(addShortcutAtom);
  const removeShortcut = useSetAtom(removeShortcutAtom);
  const setActiveShortcut = useSetAtom(setActiveShortcutAtom);

  return {
    shortcutTabs,
    activeShortcut,
    addShortcut,
    removeShortcut,
    setActiveShortcut,
  };
};

/**
 * Hook for tab counts only.
 * Only re-renders when any tab count changes.
 */
export const useGlobalTabCounts = () => {
  return useAtomValue(tabCountsAtom);
};

// ============================================
// Combined Hook
// ============================================

export interface GlobalTabsState {
  browser: BrowserTab[];
  terminal: TerminalSession[];
  editor: EditorRepo[];
  files: DocumentFile[];
  sessions: WorkspaceSession[];
  shortcuts: ShortcutItem[];
}

/**
 * Combined hook for all global tabs.
 *
 * ⚠️ PERFORMANCE WARNING: This hook subscribes to ALL tab categories.
 * Any change to ANY tab category will cause a re-render.
 *
 * PREFER using focused hooks when you only need specific categories:
 * - useGlobalBrowserTabs() - for browser tabs
 * - useGlobalTerminalTabs() - for terminal sessions
 * - useGlobalEditorTabs() - for editor repos
 * - useGlobalDocumentTabs() - for document files
 * - useGlobalSessionTabs() - for workspace sessions
 * - useGlobalShortcutTabs() - for shortcuts
 * - useGlobalTabCounts() - for counts only
 *
 * @deprecated Prefer focused hooks for better performance
 */
export const useGlobalTabs = () => {
  // Use focused hooks internally to maintain consistent API
  const {
    browserTabs,
    activeBrowser,
    addBrowserTab,
    removeBrowserTab,
    setActiveBrowserTab,
    updateBrowserTab,
  } = useGlobalBrowserTabs();

  const {
    terminalTabs,
    activeTerminal,
    addTerminalSession,
    removeTerminalSession,
    setActiveTerminalSession,
  } = useGlobalTerminalTabs();

  const {
    editorTabs,
    activeEditor,
    addEditorRepo,
    removeEditorRepo,
    setActiveEditorRepo,
  } = useGlobalEditorTabs();

  const {
    documentTabs,
    activeDocument,
    addDocumentFile,
    removeDocumentFile,
    setActiveDocumentFile,
  } = useGlobalDocumentTabs();

  const {
    sessionTabs,
    activeSession,
    addWorkspaceSession,
    removeWorkspaceSession,
    setActiveWorkspaceSession,
  } = useGlobalSessionTabs();

  const {
    shortcutTabs,
    activeShortcut,
    addShortcut,
    removeShortcut,
    setActiveShortcut,
  } = useGlobalShortcutTabs();

  const counts = useGlobalTabCounts();

  // Memoize the combined tabs object to prevent new object on every render
  const tabs = useMemo<GlobalTabsState>(
    () => ({
      browser: browserTabs,
      terminal: terminalTabs,
      editor: editorTabs,
      files: documentTabs,
      sessions: sessionTabs,
      shortcuts: shortcutTabs,
    }),
    [
      browserTabs,
      terminalTabs,
      editorTabs,
      documentTabs,
      sessionTabs,
      shortcutTabs,
    ]
  );

  return {
    // State
    tabs,
    counts,

    // Active items
    activeBrowser,
    activeTerminal,
    activeEditor,
    activeDocument,
    activeSession,
    activeShortcut,

    // Browser actions
    addBrowserTab,
    removeBrowserTab,
    setActiveBrowserTab,
    updateBrowserTab,

    // Terminal actions
    addTerminalSession,
    removeTerminalSession,
    setActiveTerminalSession,

    // Editor actions
    addEditorRepo,
    removeEditorRepo,
    setActiveEditorRepo,

    // Document actions
    addDocumentFile,
    removeDocumentFile,
    setActiveDocumentFile,

    // Session actions
    addWorkspaceSession,
    removeWorkspaceSession,
    setActiveWorkspaceSession,

    // Shortcut actions
    addShortcut,
    removeShortcut,
    setActiveShortcut,
  };
};
