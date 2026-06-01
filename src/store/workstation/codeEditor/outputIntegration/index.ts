/**
 * Code Editor — output integration refs
 *
 * Jotai atoms that hold hook instances (git output panel, task output) so
 * non-React-tree code can invoke them. Set from EditorIntegrations.
 */

export * from "./gitOutputAtom";
export * from "./taskOutputAtom";
