import { atom } from "jotai";

import type { PendingSessionProposal } from "@src/engines/SessionCore/hooks/useAgentADEActions";
import type { GuiControlRunStatus } from "@src/scaffold/GlobalSpotlight/palettes/AgentControlPalette/types";

export interface AdeManagerPaletteState {
  sessionId: string | null;
  draftText: string;
  runStatus: GuiControlRunStatus;
  activityCursor: number;
  pendingProposal: PendingSessionProposal | null;
}

const INITIAL_STATE: AdeManagerPaletteState = {
  sessionId: null,
  draftText: "",
  runStatus: "idle",
  activityCursor: 0,
  pendingProposal: null,
};

export const adeManagerPaletteAtom =
  atom<AdeManagerPaletteState>(INITIAL_STATE);
