/**
 * Launchpad dashboard selection atom.
 *
 * Tracks which workspace card is "highlighted" on the dashboard so the
 * action strip can render context-specific buttons (Switch / Start
 * session / Open details / Locate in Finder / Remove) without changing
 * the global selected repo or opening a tab. The user explicitly does
 * not want clicking a card to navigate or mutate global state — that
 * is what the strip's actions are for.
 *
 * Ephemeral (in-memory) — selection is lost on app restart and is not
 * shared between launchpad and other apps.
 */
import { atom } from "jotai";

export const launchpadSelectedRepoIdAtom = atom<string | null>(null);
launchpadSelectedRepoIdAtom.debugLabel = "launchpadSelectedRepoIdAtom";
