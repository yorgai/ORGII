import { atom } from "jotai";

/** Whether the current draft session creator has user-typed content */
export const draftHasContentAtom = atom<boolean>(false);
draftHasContentAtom.debugLabel = "draftHasContentAtom";
