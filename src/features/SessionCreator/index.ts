/**
 * SessionCreator Feature - Shell Export
 *
 * The Shell is the shared SessionCreator base component composed by all
 * variants (`Factory`, `Inbox`, `ChatPanel`, and the embedded layout).
 * Variants live in `./variants` and are re-exported by
 * `./exports`.
 */
export { default as SessionCreatorShell } from "./Shell";
export type { SessionCreatorShellProps } from "./Shell";
