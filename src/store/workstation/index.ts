/**
 * Workstation Store
 *
 * State management for all Workstation apps:
 * - Code Editor: terminal, file explorer, search, test runner, extensions
 * - Database: connections, tabs
 * - Browser: sessions, design tokens
 *
 * Also includes the shared tab system.
 *
 * Note: Some submodules have name conflicts with the shared tab system.
 * Import directly from subpaths when needed:
 * - "@src/store/workstation/tabs" - shared tab types & mutations
 * - "@src/store/workstation/database" - database connections & tabs
 * - "@src/store/workstation/browser/tabs" - browser-specific tabs
 */

// Shared tab system (types, mutations, factories)
export * from "./tabs";

// Cross-host tab index (derived) + routed writers
export * from "./tabRegistry";

// Unified dock filter (Phase 1: atom only; Phase 2 wires UI + URL sync).
export * from "./dockFilter";

// Workstation TabBar (AppShell) coordination atoms
export {
  workstationNewBrowserSessionRequestAtom,
  requestNewBrowserSessionAtom,
  type WorkstationNewBrowserSessionRequest,
  workstationProjectTabBarAtom,
  OPS_CONTROL_HOME_TAB,
  opsControlFocusedTabAtom,
  opsControlHomeTabAtom,
  opsControlPeekHostAtom,
  type OpsControlHomeTab,
  workstationTabHeaderAtomByHost,
  activeWorkstationTabHeaderAtom,
  normalizeWorkstationTabHeaderContribution,
  type WorkstationTabHeaderContribution,
  type WorkstationTabHeaderSlots,
} from "./workstationTabBarAtoms";

// Code Editor app (terminal, file, search, testRunner, extensions)
export * from "./codeEditor";

// Browser app - tokens only
// Note: Import browser tabs from "@src/store/workstation/browser/tabs" directly
export * from "./browser/tokens";

// Note: Database has name conflicts with shared tabs - import directly:
// import { ... } from "@src/store/workstation/database";
