import { createStore } from "jotai";
import { describe, expect, it } from "vitest";

import {
  collabPendingShareAtom,
  consumeCollabPendingShareAtom,
} from "../collabPendingShareAtom";
import type { CollabPendingShare } from "../collabPendingShareAtom";

const SHARE: CollabPendingShare = {
  supabaseUrl: "https://team-project.supabase.co",
  anonKey: "anon-public-key",
  orgId: "org-42",
  shareToken: "a".repeat(64),
};

describe("collabPendingShareAtom one-shot semantics", () => {
  it("returns the pending share exactly once and clears it", () => {
    const store = createStore();
    store.set(collabPendingShareAtom, SHARE);

    expect(store.set(consumeCollabPendingShareAtom)).toEqual(SHARE);
    expect(store.get(collabPendingShareAtom)).toBeNull();
    // Second consumer (or a re-render) must not replay the import.
    expect(store.set(consumeCollabPendingShareAtom)).toBeNull();
  });

  it("returns null when nothing is pending", () => {
    const store = createStore();
    expect(store.set(consumeCollabPendingShareAtom)).toBeNull();
    expect(store.get(collabPendingShareAtom)).toBeNull();
  });

  it("a newer share replaces an unconsumed one wholesale", () => {
    const store = createStore();
    store.set(collabPendingShareAtom, SHARE);
    const newer: CollabPendingShare = {
      ...SHARE,
      shareToken: "b".repeat(64),
      inviteCode: "invite-1",
    };
    store.set(collabPendingShareAtom, newer);
    expect(store.set(consumeCollabPendingShareAtom)).toEqual(newer);
    expect(store.set(consumeCollabPendingShareAtom)).toBeNull();
  });
});
