/**
 * Cursor Model Override Atom Family
 *
 * Per-session scratch space for the model the user has picked in the
 * `CursorModelPill` dropdown but hasn't yet sent. The pill writes the
 * picked model name (or `null` to clear) and `InputArea`'s send
 * handler reads it at submit time, passing it as the `model` override
 * to `SessionService.sendMessage` so `cursorIdeAdapter.sendMessage`
 * can apply it composer-targeted right before the prompt lands.
 *
 * Atom-family-scoped because:
 *  - The pick is local to *this* composer; switching to another
 *    Cursor IDE chat shouldn't carry the pick across.
 *  - The pill itself unmounts on the way out and clears the value,
 *    so this atom rarely lingers — but the family prevents two
 *    Cursor IDE chats open in different panes from stomping on each
 *    other's selection.
 *
 * NOT persisted. The composer's last-used model already lives in
 * Cursor's `state.vscdb` (and is what `useCursorModels` reads as the
 * seed); persisting the *transient* draft pick here would just race
 * with that source of truth.
 */
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const cursorModelOverrideAtomFamily = atomFamily((sessionId: string) => {
  const sessionAtom = atom<string | null>(null);
  sessionAtom.debugLabel = `cursorModelOverride(${sessionId})`;
  return sessionAtom;
});

/**
 * Pre-launch model pick for the SessionCreator's Cursor IDE flow.
 *
 * The in-session atom family above keys on `sessionId`, but the
 * SessionCreator hasn't created a session yet — it's about to. We
 * stash the user's draft model pick here, and `useSessionLaunch`
 * reads it once when calling `cursorBridgeNewComposer` so the
 * fresh composer is born with the right model. Cleared after
 * launch (or on creator unmount) so the next visit starts neutral.
 */
export const cursorCreatorModelOverrideAtom = atom<string | null>(null);
cursorCreatorModelOverrideAtom.debugLabel = "cursorCreatorModelOverride";
