import { atom } from "jotai";

export type TerminalTarget =
  | { kind: "agent"; sessionId: string }
  | { kind: "pty"; ptySessionId: string };

export const codeEditorTerminalTargetAtom = atom<TerminalTarget | null>(null);
codeEditorTerminalTargetAtom.debugLabel = "codeEditorTerminalTargetAtom";
