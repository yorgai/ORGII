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
  navigationSidebarTabsAtom,
  tabCountsAtom,
} from "@src/store/ui/navigationSidebarTabsAtom";
import { activeEditorRepoAtom } from "@src/store/workstation/tabs";

// ============================================
// Selector Atoms (created once, reused)
// ============================================

const browserTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.browser
);
const terminalTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.terminal
);
const editorTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.editor
);
const filesTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.files
);
const sessionsTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.sessions
);
const shortcutsTabsAtom = selectAtom(
  navigationSidebarTabsAtom,
  (tabs) => tabs.shortcuts
);

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
