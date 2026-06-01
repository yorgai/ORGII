import { atom } from "jotai";

// NOTE: Import directly from the leaf file (not the barrel) to avoid pulling
// the whole SidebarModules tree — which transitively re-imports @src/store —
// back into the store layer and creating a circular dependency.
import type { SourceControlFilterMode } from "@src/modules/WorkStation/shared/SidebarModules/SourceControl/SourceControlFilterHeader";

/** Active Source Control sidebar filter (file buckets or git history graph). */
export const sourceControlFilterModeAtom =
  atom<SourceControlFilterMode>("uncommitted");
sourceControlFilterModeAtom.debugLabel = "sourceControlFilterModeAtom";

/** Registered by Code Editor so global header actions can apply filter side effects. */
export const sourceControlFilterModeHandlerAtom = atom<
  ((mode: SourceControlFilterMode) => void) | null
>(null);
sourceControlFilterModeHandlerAtom.debugLabel =
  "sourceControlFilterModeHandlerAtom";
