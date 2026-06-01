import { atom } from "jotai";
import { atomFamily } from "jotai-family";

import type { CursorIdeTurnSummary } from "@src/api/tauri/cursorIde";

export const cursorIdeTurnSummariesAtomFamily = atomFamily(
  (sessionId: string) => {
    const sessionAtom = atom<CursorIdeTurnSummary[]>([]);
    sessionAtom.debugLabel = `cursorIdeTurnSummaries(${sessionId})`;
    return sessionAtom;
  }
);
