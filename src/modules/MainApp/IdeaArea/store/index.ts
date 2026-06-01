import { atom } from "jotai";

import type { IdeaAreaView } from "../components/IdeaMenuPanel";

export const ideaAreaActiveViewAtom = atom<IdeaAreaView>("trending");
