import { describe, expect, it, vi } from "vitest";

import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type { CollabSessionAccessSettings } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import { computeSessionMetadataHash } from "./collabSyncEngineHelpers";

vi.mock("@src/engines/SessionCore/core/store/EventStoreProxy", () => ({
  eventStoreProxy: {
    subscribe: vi.fn(),
    getEvents: vi.fn(),
    getPersistedEvents: vi.fn(),
    set: vi.fn(),
    saveToCache: vi.fn(),
  },
}));

const SESSION: Session = {
  session_id: "session-1",
  status: "completed",
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  name: "Local session",
  repoPath: "/repo/shared",
};

function createSettings(
  overrides: Partial<CollabSessionAccessSettings> = {}
): CollabSessionAccessSettings {
  return {
    orgId: "org-1",
    memberId: "member-1",
    accessMode: COLLAB_SESSION_ACCESS_MODE.FULL_REPLAY,
    workspaceScope: COLLAB_WORKSPACE_SCOPE.SELECTED_WORKSPACES,
    workspacePaths: [],
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeSessionMetadataHash sharing inputs", () => {
  it("changes when the published visibility flips org ↔ restricted (M4b)", () => {
    const orgVisible = computeSessionMetadataHash(SESSION, createSettings());
    const restricted = computeSessionMetadataHash(
      SESSION,
      createSettings({ sessionVisibility: { "session-1": "restricted" } })
    );
    expect(restricted).not.toBe(orgVisible);
    // The hash gate must re-push exactly this session — an entry for another
    // session leaves the hash untouched.
    const otherSessionRestricted = computeSessionMetadataHash(
      SESSION,
      createSettings({ sessionVisibility: { "session-2": "restricted" } })
    );
    expect(otherSessionRestricted).toBe(orgVisible);
  });

  it("changes when a per-session override changes the effective mode", () => {
    const base = computeSessionMetadataHash(SESSION, createSettings());
    const overridden = computeSessionMetadataHash(
      SESSION,
      createSettings({
        sessionOverrides: {
          "session-1": COLLAB_SESSION_ACCESS_MODE.METADATA_ONLY,
        },
      })
    );
    expect(overridden).not.toBe(base);
  });
});
