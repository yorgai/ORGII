import { atom } from "jotai";

import type { CollabShareDeepLink } from "./deepLink";

/**
 * A session share captured from an `orgii://collaboration/session` deep link
 * (design §6.4), waiting to be consumed by the share-import confirmation
 * dialog (resolve token → show session title/owner → import read-only →
 * openSession; combined links then surface the "join this org" CTA).
 *
 * In-memory only and strictly one-shot — consumers must go through
 * `consumeCollabPendingShare` so a re-render can never replay the import.
 * Aligned with `collabPendingInviteAtom`.
 */
export type CollabPendingShare = CollabShareDeepLink;

export const collabPendingShareAtom = atom<CollabPendingShare | null>(null);
collabPendingShareAtom.debugLabel = "collabPendingShareAtom";

/**
 * Write-only consume atom: returns the pending share (or null) and clears it
 * in the same transaction, so exactly one consumer ever sees a given link.
 */
export const consumeCollabPendingShareAtom = atom(
  null,
  (get, set): CollabPendingShare | null => {
    const pending = get(collabPendingShareAtom);
    if (pending) set(collabPendingShareAtom, null);
    return pending;
  }
);
consumeCollabPendingShareAtom.debugLabel = "consumeCollabPendingShareAtom";
