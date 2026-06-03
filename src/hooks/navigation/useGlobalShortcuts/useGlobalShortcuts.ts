import { useInspectModeShortcuts } from "./useInspectModeShortcuts";
import { useShortcutRegistration } from "./useShortcutRegistration";
import { useTabShortcuts } from "./useTabShortcuts";
import { useWindowShortcuts } from "./useWindowShortcuts";
import { useZoomShortcuts } from "./useZoomShortcuts";

/**
 * Global keyboard shortcuts hook
 *
 * Handles:
 * - Backspace: Prevented from triggering any navigation (only works in input fields)
 * - Command+Q (Meta+Q): Confirm before quitting the app
 * - Command+W (Meta+W): Close current tab with special home page logic
 * - Command+M (Meta+M): Hide the window (minimize to background)
 * - Command+N (Meta+N): Create a new Agent Station session
 * - Command+T (Meta+T): Context-aware navigation
 * - Command+L (Meta+L): Same as Command+T (context-aware)
 * - Command+, / Ctrl+,: Open settings
 * - Command+Shift+P (Meta+Shift+P): Toggle spotlight search
 * - Command+/ (Meta+/): Open the global model selector palette
 * - Command+. (Meta+.): Open the global workspace (repo) selector palette
 * - Option+Command+. (Ctrl+Alt+.): Open the branch selector for the
 *   current session creator
 * - Shift+Command+. (Ctrl+Shift+.): Open the running-location selector
 *   for the current session creator
 * - Command+K / Ctrl+K: Search Agent sessions
 * - Command+8 (Meta+8): Toggle inspect element mode
 * - Command+9 (Meta+9): Capture hovered component issue payload
 * - Command+5 (Meta+5): Toggle API calls panel
 * - Command+B / Ctrl+B: Toggle Workstation sidebar
 * - Command+E / Ctrl+E: Open Workstation Code Editor source control tab
 * - Command+J / Ctrl+J: Open Workstation Code Editor terminal tab
 * - Command+Option+B / Ctrl+Alt+B: Focus Chat Panel or show Workstation
 * - Command+Option+M / Ctrl+Alt+M: Toggle My Station / Agent's Station
 * - Command+Option+U / Ctrl+Alt+U: Toggle main sidebar
 * - Command+= (Meta+=): Zoom in (increase UI scale)
 * - Command+- (Meta+-): Zoom out (decrease UI scale)
 * - Command+0 (Meta+0): Reset zoom to default (100%)
 * - Command+Shift+0 (Meta+Shift+0): Toggle route inspector modal
 * - Ctrl+Tab or Command+Option+→: Switch to next tab
 * - Ctrl+Shift+Tab or Command+Option+←: Switch to previous tab
 */
export const useGlobalShortcuts = () => {
  const {
    inspectModeRef,
    handleToggleInspectMode,
    handleInspectMoveUpLevel,
    handleInspectMoveDownLevel,
    handleInspectToggleLabels,
    handleInspectHideLabels,
    handleShowComponentIssue,
  } = useInspectModeShortcuts();

  const { handleZoomIn, handleZoomOut, handleZoomReset } = useZoomShortcuts();

  const { handleQuit, confirmAndQuit, handleHideWindow } = useWindowShortcuts();

  const {
    spotlightOpen,
    spotlightOpenRef,
    handleCreateNewSession,
    handleGoToCreateSession,
    handleToggleSpotlight,
    handleOpenModelSelector,
    handleOpenWorkspaceSelector,
    handleOpenBranchSelector,
    handleOpenLocationSelector,
    handleOpenAgentSessionSearch,
    handleOpenSettings,
    handleOpenWorkStationFilePalette,
    handleOpenWorkStationSymbolPalette,
    handleToggleSidebar,
    handleToggleAPICallPanel,
    handleToggleWorkstationSidebar,
    handleOpenCodeEditorFileFolder,
    handleOpenCodeEditorSourceControl,
    handleOpenCodeEditorSearchSidebar,
    handleOpenCodeEditorTerminal,
    handleNextTab,
    handlePreviousTab,
    handleCloseCurrentTab,
    handleToggleWorkStationChatFocus,
    handleToggleStationMode,
  } = useTabShortcuts();

  // Wire everything into the keydown listener + registry
  useShortcutRegistration({
    inspectModeRef,
    handleInspectMoveUpLevel,
    handleInspectMoveDownLevel,
    handleInspectToggleLabels,
    handleInspectHideLabels,
    handleToggleInspectMode,
    handleShowComponentIssue,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleQuit,
    confirmAndQuit,
    handleHideWindow,
    spotlightOpenRef,
    handleCreateNewSession,
    handleGoToCreateSession,
    handleToggleSpotlight,
    handleOpenModelSelector,
    handleOpenWorkspaceSelector,
    handleOpenBranchSelector,
    handleOpenLocationSelector,
    handleOpenAgentSessionSearch,
    handleOpenSettings,
    handleToggleSidebar,
    handleOpenWorkStationFilePalette,
    handleOpenWorkStationSymbolPalette,
    handleToggleAPICallPanel,
    handleToggleWorkstationSidebar,
    handleOpenCodeEditorFileFolder,
    handleOpenCodeEditorSourceControl,
    handleOpenCodeEditorSearchSidebar,
    handleOpenCodeEditorTerminal,
    handleNextTab,
    handlePreviousTab,
    handleCloseCurrentTab,
    handleToggleWorkStationChatFocus,
    handleToggleStationMode,
  });

  return {
    handleQuit,
    handleCloseCurrentTab,
    handleHideWindow,
    handleGoToCreateSession,
    handleCreateNewSession,
    handleToggleInspectMode,
    handleShowComponentIssue,
    handleToggleAPICallPanel,
    handleToggleSidebar,
    handleOpenCodeEditorFileFolder,
    handleOpenCodeEditorSourceControl,
    handleOpenCodeEditorSearchSidebar,
    handleOpenCodeEditorTerminal,
    handleNextTab,
    handlePreviousTab,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleInspectMoveUpLevel,
    handleInspectMoveDownLevel,
    handleInspectToggleLabels,
    handleInspectHideLabels,
    handleToggleSpotlight,
    spotlightOpen,
  };
};

export default useGlobalShortcuts;
