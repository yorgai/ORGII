/**
 * Cursor Mode Override Atom Family
 *
 * Per-session scratch space for the unified mode the user has picked
 * in the `CursorModePill` dropdown but hasn't yet sent. Mirrors
 * `cursorModelOverrideAtomFamily` one-for-one — same lifetime
 * semantics, same submit-time read pattern in `InputArea`, same
 * unmount-clears-the-pick discipline.
 *
 * The pick is stashed here while typing, then `cursorIdeAdapter`'s
 * send pipeline reads it at submit time and fires
 * `cursor_bridge_set_mode` against the active composer right
 * before typing the prompt. That way the next message lands in the
 * mode the user picked without an extra CDP round-trip on every
 * dropdown click.
 *
 * NOT persisted. The composer's last-used mode already lives in
 * `state.vscdb` as `composerData:<uuid>.unifiedMode` (and is what
 * `useCursorModes` reads as the seed).
 */
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const cursorModeOverrideAtomFamily = atomFamily((sessionId: string) => {
  const sessionAtom = atom<string | null>(null);
  sessionAtom.debugLabel = `cursorModeOverride(${sessionId})`;
  return sessionAtom;
});

/**
 * Pre-launch mode pick for the SessionCreator's Cursor IDE flow.
 *
 * The in-session atom family above keys on `sessionId`, but the
 * SessionCreator hasn't created a session yet. We stash the user's
 * draft mode pick here, and `useSessionLaunch` reads it once when
 * calling `cursorBridgeNewComposer` so the fresh composer is
 * stamped with the right mode after creation. Cleared after launch
 * (or on creator unmount) so the next visit starts neutral.
 */
export const cursorCreatorModeOverrideAtom = atom<string | null>(null);
cursorCreatorModeOverrideAtom.debugLabel = "cursorCreatorModeOverride";
