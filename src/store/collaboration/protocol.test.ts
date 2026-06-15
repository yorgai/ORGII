import { describe, expect, it } from "vitest";

import {
  buildCollabInviteLink,
  createCollabAvatarIdentity,
  normalizeCollabHubUrl,
  parseCollabInviteInput,
  toCollabWebSocketUrl,
} from "./protocol";

describe("collaboration protocol helpers", () => {
  it("normalizes hub URLs", () => {
    expect(
      normalizeCollabHubUrl("https://team.example.workers.dev/path/?x=1#y")
    ).toBe("https://team.example.workers.dev/path");
  });

  it("builds and parses invite links", () => {
    const link = buildCollabInviteLink({
      hubUrl: "https://team.example.workers.dev/",
      inviteCode: "invite-1",
    });

    expect(parseCollabInviteInput(link)).toEqual({
      hubUrl: "https://team.example.workers.dev",
      inviteCode: "invite-1",
    });
  });

  it("accepts raw invite codes", () => {
    expect(parseCollabInviteInput(" invite-2 ")).toEqual({
      inviteCode: "invite-2",
    });
  });

  it("converts HTTP hub URL to WebSocket room URL", () => {
    expect(
      toCollabWebSocketUrl("https://team.example.workers.dev", "org-1")
    ).toBe("wss://team.example.workers.dev/orgs/org-1/ws");
  });

  it("creates deterministic lightweight avatar identities", () => {
    expect(createCollabAvatarIdentity("Ada Lovelace").initials).toBe("AL");
    expect(["v", "h"]).toContain(
      createCollabAvatarIdentity("Ada Lovelace").variant
    );
  });
});
