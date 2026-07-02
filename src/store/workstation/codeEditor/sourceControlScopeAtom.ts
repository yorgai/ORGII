import { atom } from "jotai";

import type { SourceControlScopeMap } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/tabs/sourceControlScopePickerHelpers";

/** Per-repo Source Control scope for the current app session (not persisted). */
export const sourceControlScopeMapAtom = atom<SourceControlScopeMap>({});
sourceControlScopeMapAtom.debugLabel = "sourceControlScopeMapAtom";
