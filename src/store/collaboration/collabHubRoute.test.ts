import { describe, expect, it } from "vitest";

import { matchCollabHubRoute } from "../../../cloudflare/collab-hub/src/route";

function request(method: string, path: string): Request {
  return new Request(`https://hub.example${path}`, { method });
}

describe("Cloudflare collaboration hub routes", () => {
  it("matches org creation", () => {
    expect(matchCollabHubRoute(request("POST", "/orgs"))).toEqual({
      kind: "createOrg",
    });
  });

  it("matches invite creation", () => {
    expect(matchCollabHubRoute(request("POST", "/orgs/org-1/invites"))).toEqual(
      {
        kind: "createInvite",
        orgId: "org-1",
      }
    );
  });

  it("matches invite acceptance", () => {
    expect(
      matchCollabHubRoute(request("POST", "/invites/token-1/accept"))
    ).toEqual({
      kind: "acceptInvite",
      inviteCode: "token-1",
    });
  });

  it("matches member removal", () => {
    expect(
      matchCollabHubRoute(
        request("POST", "/orgs/org-1/members/member-1/remove")
      )
    ).toEqual({
      kind: "removeMember",
      orgId: "org-1",
      memberId: "member-1",
    });
  });

  it("matches WebSocket route", () => {
    expect(matchCollabHubRoute(request("GET", "/orgs/org-1/ws"))).toEqual({
      kind: "webSocket",
      orgId: "org-1",
    });
  });
});
