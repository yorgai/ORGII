import { describe, expect, it, vi } from "vitest";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  COLLAB_SESSION_ACCESS_MODE,
  COLLAB_WORKSPACE_SCOPE,
} from "@src/store/collaboration/types";
import type { CollabSessionAccessSettings } from "@src/store/collaboration/types";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  computeSessionMetadataHash,
  splitFrozenIntoSegments,
} from "./collabSyncEngineHelpers";

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

  it("changes on status / branch / lastActivityAt but not on a repoPath move", () => {
    const settings = createSettings();
    const base = computeSessionMetadataHash(SESSION, settings);

    expect(
      computeSessionMetadataHash({ ...SESSION, status: "running" }, settings)
    ).not.toBe(base);
    expect(
      computeSessionMetadataHash({ ...SESSION, branch: "feat/x" }, settings)
    ).not.toBe(base);
    // updated_at is bucketed to the minute — a full-minute move crosses the
    // bucket boundary and changes the hash (a sub-minute move would not).
    expect(
      computeSessionMetadataHash(
        { ...SESSION, updated_at: "2026-07-01T00:01:00.000Z" },
        settings
      )
    ).not.toBe(base);
    // repoPath is DELIBERATELY excluded — a local path move must not re-push.
    expect(
      computeSessionMetadataHash(
        { ...SESSION, repoPath: "/repo/moved" },
        settings
      )
    ).toBe(base);
  });
});

describe("splitFrozenIntoSegments 256KB packing", () => {
  const SEGMENT_MAX_BYTES = 256 * 1024;

  function makeEvent(id: string, payload = ""): SessionEvent {
    return {
      id,
      sessionId: "session-1",
      displayStatus: "completed",
      payload,
    } as unknown as SessionEvent;
  }

  it("packs a >256KB event stream into multiple ≤256KB segments that round-trip", () => {
    // ~50KB per event so a handful crosses the 256KB cap and forces >1 segment.
    const bigPayload = "x".repeat(50 * 1024);
    const events = Array.from({ length: 12 }, (_unused, index) =>
      makeEvent(`e${index}`, bigPayload)
    );
    const totalBytes = events.reduce(
      (sum, event) => sum + JSON.stringify(event).length,
      0
    );
    expect(totalBytes).toBeGreaterThan(SEGMENT_MAX_BYTES);

    const segments = splitFrozenIntoSegments(events, 1);

    // More than one frozen segment was produced.
    expect(segments.length).toBeGreaterThan(1);
    // Each segment is within the byte cap (an event's own size can be counted,
    // but no segment packs beyond the cap once it holds >1 event).
    for (const segment of segments) {
      const segmentBytes = segment.events.reduce(
        (sum, event) => sum + JSON.stringify(event).length,
        0
      );
      expect(segmentBytes).toBeLessThanOrEqual(SEGMENT_MAX_BYTES);
    }
    // Seqs are contiguous from the requested start.
    expect(segments.map((segment) => segment.seq)).toEqual(
      segments.map((_unused, index) => 1 + index)
    );
    // Concatenating the segments' events round-trips the full input in order.
    const flattened = segments.flatMap((segment) => segment.events);
    expect(flattened.map((event) => event.id)).toEqual(
      events.map((event) => event.id)
    );
    expect(flattened).toEqual(events);
  });

  it("ships an oversized single event as its own segment (never drops it)", () => {
    // A single event larger than the cap must still ship — at least one event
    // per segment (design §7.3 step 3a).
    const oversized = makeEvent("huge", "y".repeat(SEGMENT_MAX_BYTES + 1_000));
    const segments = splitFrozenIntoSegments([oversized], 5);
    expect(segments).toHaveLength(1);
    expect(segments[0].seq).toBe(5);
    expect(segments[0].events).toHaveLength(1);
    expect(segments[0].events[0].id).toBe("huge");
  });
});
