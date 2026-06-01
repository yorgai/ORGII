/**
 * Re-export from ComposerInput so the Tiptap FilePillNode (still used by the
 * heavyweight RichTextEditor) keeps importing from the same module path
 * while sharing a single source of truth.
 */
export type { PillIconType } from "@src/components/ComposerInput";
