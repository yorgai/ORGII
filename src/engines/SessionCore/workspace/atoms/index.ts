/**
 * Workspace Atoms Index
 *
 * Re-exports all workspace-scoped Jotai atoms.
 * Migrated from contexts/workspace/ (React Contexts → Jotai)
 */

// Session atoms (from SessionContext)
export * from "./sessionAtoms";

// UI atoms (from UIContext)
export * from "./uiAtoms";

// Note: Chat/Socket atoms were removed (2026-03-30) as they duplicated
// ChatContext/SocketContext state. Use ChatContext from contexts/workspace/
// for chat UI state instead.
//
// DataContext atoms are not migrated yet due to complexity (~30 state values).
// Consider migrating incrementally or keeping as React Context if page-scoped.
