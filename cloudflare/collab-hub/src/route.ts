export const COLLAB_HUB_ROUTE = {
  ORGS: "orgs",
  INVITES: "invites",
  MEMBERS: "members",
  BOOTSTRAP: "bootstrap",
  WS: "ws",
  REMOVE: "remove",
} as const;

export type CollabHubRouteMatch =
  | { kind: "createOrg" }
  | { kind: "createInvite"; orgId: string }
  | { kind: "acceptInvite"; inviteCode: string }
  | { kind: "removeMember"; orgId: string; memberId: string }
  | { kind: "bootstrap"; orgId: string }
  | { kind: "webSocket"; orgId: string }
  | { kind: "notFound" };

export function matchCollabHubRoute(request: Request): CollabHubRouteMatch {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "POST" && parts.length === 1 && parts[0] === "orgs") {
    return { kind: "createOrg" };
  }

  if (
    request.method === "POST" &&
    parts.length === 3 &&
    parts[0] === COLLAB_HUB_ROUTE.ORGS &&
    parts[2] === COLLAB_HUB_ROUTE.INVITES
  ) {
    return { kind: "createInvite", orgId: parts[1] };
  }

  if (
    request.method === "POST" &&
    parts.length === 3 &&
    parts[0] === COLLAB_HUB_ROUTE.INVITES &&
    parts[2] === "accept"
  ) {
    return { kind: "acceptInvite", inviteCode: parts[1] };
  }

  if (
    request.method === "POST" &&
    parts.length === 5 &&
    parts[0] === COLLAB_HUB_ROUTE.ORGS &&
    parts[2] === COLLAB_HUB_ROUTE.MEMBERS &&
    parts[4] === COLLAB_HUB_ROUTE.REMOVE
  ) {
    return { kind: "removeMember", orgId: parts[1], memberId: parts[3] };
  }

  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[0] === COLLAB_HUB_ROUTE.ORGS &&
    parts[2] === COLLAB_HUB_ROUTE.BOOTSTRAP
  ) {
    return { kind: "bootstrap", orgId: parts[1] };
  }

  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[0] === COLLAB_HUB_ROUTE.ORGS &&
    parts[2] === COLLAB_HUB_ROUTE.WS
  ) {
    return { kind: "webSocket", orgId: parts[1] };
  }

  return { kind: "notFound" };
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}
