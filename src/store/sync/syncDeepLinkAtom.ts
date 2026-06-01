/**
 * Pending request to deep-link into a project's Sync subpage
 * (Phase 4.8 Track D).
 *
 * Set by `ProjectSyncStatusWidget` when the user clicks the status-bar
 * pill; consumed by `WorkItemsPage` (matching `slug`), which switches
 * to the Settings view + selects the "sync" section, then clears this
 * atom.
 *
 * The request is slug-keyed so a stale request from one project never
 * opens the wrong project's settings page after the user navigates.
 */
import { atom } from "jotai";

export interface SyncDeepLinkRequest {
  slug: string;
  /** Section ID inside `WorkItemsSettings` to focus. */
  section: "sync";
  /** Monotonic stamp to deduplicate repeat clicks on the same slug. */
  stamp: number;
}

export const syncDeepLinkAtom = atom<SyncDeepLinkRequest | null>(null);
syncDeepLinkAtom.debugLabel = "syncDeepLink";
