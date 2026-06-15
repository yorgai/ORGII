import { jsonResponse, matchCollabHubRoute } from "./route";

const COLLAB_ROLE = {
  ADMIN: "admin",
  MEMBER: "member",
} as const;

const COLLAB_IDENTITY_KIND = {
  HUMAN: "human",
  AGENT: "agent",
} as const;

type CollabRole = (typeof COLLAB_ROLE)[keyof typeof COLLAB_ROLE];
type CollabIdentityKind =
  (typeof COLLAB_IDENTITY_KIND)[keyof typeof COLLAB_IDENTITY_KIND];

interface Env {
  DB: D1Database;
  ORG_ROOMS: DurableObjectNamespace<CollabOrgRoom>;
}

interface CreateOrgRequest {
  name?: string;
  displayName?: string;
  identityKind?: CollabIdentityKind;
}

interface AcceptInviteRequest {
  displayName?: string;
  identityKind?: CollabIdentityKind;
}

interface CreateInviteRequest {
  expiresAt?: string;
  usageLimit?: number;
}

interface StoredMember {
  id: string;
  org_id: string;
  display_name: string;
  avatar_initials: string;
  avatar_variant: string;
  role: CollabRole;
  identity_kind: CollabIdentityKind;
  joined_at: string;
  removed_at: string | null;
}

interface StoredOrg {
  id: string;
  name: string;
  admin_member_id: string;
  created_at: string;
}

interface StoredInvite {
  id: string;
  org_id: string;
  token_hash: string;
  inviter_member_id: string;
  expires_at: string | null;
  usage_limit: number;
  usage_count: number;
  revoked_at: string | null;
}

interface AuthContext {
  orgId: string;
  memberId: string;
  role: CollabRole;
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function createSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createAvatar(displayName: string): {
  initials: string;
  variant: string;
} {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const initials = `${words[0]?.[0] ?? "U"}${words[1]?.[0] ?? ""}`
    .toLocaleUpperCase()
    .slice(0, 2);
  const seed = [...displayName].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0
  );
  return { initials, variant: seed % 2 === 0 ? "v" : "h" };
}

function isIdentityKind(value: unknown): value is CollabIdentityKind {
  return (
    value === COLLAB_IDENTITY_KIND.HUMAN || value === COLLAB_IDENTITY_KIND.AGENT
  );
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T;
}

function publicMember(member: StoredMember) {
  return {
    id: member.id,
    orgId: member.org_id,
    displayName: member.display_name,
    avatar: {
      initials: member.avatar_initials,
      variant: member.avatar_variant,
    },
    role: member.role,
    identityKind: member.identity_kind,
    joinedAt: member.joined_at,
    removedAt: member.removed_at ?? undefined,
  };
}

function publicOrg(org: StoredOrg) {
  return {
    id: org.id,
    name: org.name,
    adminMemberId: org.admin_member_id,
    createdAt: org.created_at,
  };
}

function readBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  const url = new URL(request.url);
  return url.searchParams.get("access_token");
}

async function getAuthContext(
  request: Request,
  env: Env,
  orgId: string
): Promise<AuthContext | null> {
  const accessToken = readBearerToken(request);
  if (!accessToken) return null;
  const tokenHash = await sha256(accessToken);
  const member = await env.DB.prepare(
    "SELECT id, role FROM members WHERE org_id = ? AND access_token_hash = ? AND removed_at IS NULL"
  )
    .bind(orgId, tokenHash)
    .first<{ id: string; role: CollabRole }>();
  if (!member) return null;
  return { orgId, memberId: member.id, role: member.role };
}

async function requireAdmin(
  request: Request,
  env: Env,
  orgId: string
): Promise<AuthContext | Response> {
  const context = await getAuthContext(request, env, orgId);
  if (!context) return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  if (context.role !== COLLAB_ROLE.ADMIN) {
    return jsonResponse({ error: "Admin role required" }, { status: 403 });
  }
  return context;
}

async function handleCreateOrg(request: Request, env: Env): Promise<Response> {
  const body = await readJson<CreateOrgRequest>(request);
  const name = body.name?.trim();
  const displayName = body.displayName?.trim();
  const identityKind = isIdentityKind(body.identityKind)
    ? body.identityKind
    : COLLAB_IDENTITY_KIND.HUMAN;

  if (!name)
    return jsonResponse({ error: "Org name is required" }, { status: 400 });
  if (!displayName) {
    return jsonResponse({ error: "Display name is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const orgId = createId("org");
  const memberId = createId("mem");
  const accessToken = createSecret();
  const tokenHash = await sha256(accessToken);
  const avatar = createAvatar(displayName);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO orgs (id, name, admin_member_id, created_at) VALUES (?, ?, ?, ?)"
    ).bind(orgId, name, memberId, now),
    env.DB.prepare(
      "INSERT INTO members (id, org_id, display_name, avatar_initials, avatar_variant, role, identity_kind, access_token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      memberId,
      orgId,
      displayName,
      avatar.initials,
      avatar.variant,
      COLLAB_ROLE.ADMIN,
      identityKind,
      tokenHash,
      now
    ),
  ]);

  return jsonResponse({
    org: {
      id: orgId,
      name,
      adminMemberId: memberId,
      createdAt: now,
    },
    member: {
      id: memberId,
      orgId,
      displayName,
      avatar,
      role: COLLAB_ROLE.ADMIN,
      identityKind,
      accessToken,
      joinedAt: now,
    },
  });
}

async function handleCreateInvite(
  request: Request,
  env: Env,
  orgId: string
): Promise<Response> {
  const auth = await requireAdmin(request, env, orgId);
  if (auth instanceof Response) return auth;
  const body = await readJson<CreateInviteRequest>(request).catch(
    () => ({}) satisfies CreateInviteRequest
  );
  const inviteCode = createSecret();
  const tokenHash = await sha256(inviteCode);
  const inviteId = createId("inv");
  const now = new Date().toISOString();
  const usageLimit = Math.max(1, Math.min(body.usageLimit ?? 1, 100));

  await env.DB.prepare(
    "INSERT INTO invites (id, org_id, token_hash, inviter_member_id, expires_at, usage_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      inviteId,
      orgId,
      tokenHash,
      auth.memberId,
      body.expiresAt ?? null,
      usageLimit,
      now
    )
    .run();

  return jsonResponse({
    invite: {
      id: inviteId,
      orgId,
      inviteCode,
      expiresAt: body.expiresAt,
      createdAt: now,
    },
  });
}

async function handleAcceptInvite(
  request: Request,
  env: Env,
  inviteCode: string
): Promise<Response> {
  const body = await readJson<AcceptInviteRequest>(request);
  const displayName = body.displayName?.trim();
  const identityKind = isIdentityKind(body.identityKind)
    ? body.identityKind
    : COLLAB_IDENTITY_KIND.HUMAN;
  if (!displayName) {
    return jsonResponse({ error: "Display name is required" }, { status: 400 });
  }

  const tokenHash = await sha256(inviteCode);
  const invite = await env.DB.prepare(
    "SELECT id, org_id, token_hash, inviter_member_id, expires_at, usage_limit, usage_count, revoked_at FROM invites WHERE token_hash = ?"
  )
    .bind(tokenHash)
    .first<StoredInvite>();

  if (!invite || invite.revoked_at) {
    return jsonResponse({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.expires_at && Date.parse(invite.expires_at) < Date.now()) {
    return jsonResponse({ error: "Invite expired" }, { status: 410 });
  }
  if (invite.usage_count >= invite.usage_limit) {
    return jsonResponse({ error: "Invite already used" }, { status: 409 });
  }

  const org = await env.DB.prepare(
    "SELECT id, name, admin_member_id, created_at FROM orgs WHERE id = ?"
  )
    .bind(invite.org_id)
    .first<StoredOrg>();
  if (!org) return jsonResponse({ error: "Org not found" }, { status: 404 });

  const now = new Date().toISOString();
  const memberId = createId("mem");
  const accessToken = createSecret();
  const tokenHashForMember = await sha256(accessToken);
  const avatar = createAvatar(displayName);

  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO members (id, org_id, display_name, avatar_initials, avatar_variant, role, identity_kind, access_token_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      memberId,
      org.id,
      displayName,
      avatar.initials,
      avatar.variant,
      COLLAB_ROLE.MEMBER,
      identityKind,
      tokenHashForMember,
      now
    ),
    env.DB.prepare(
      "UPDATE invites SET usage_count = usage_count + 1 WHERE id = ?"
    ).bind(invite.id),
  ]);

  return jsonResponse({
    org: publicOrg(org),
    member: {
      id: memberId,
      orgId: org.id,
      displayName,
      avatar,
      role: COLLAB_ROLE.MEMBER,
      identityKind,
      accessToken,
      joinedAt: now,
    },
  });
}

async function handleRemoveMember(
  request: Request,
  env: Env,
  orgId: string,
  memberId: string
): Promise<Response> {
  const auth = await requireAdmin(request, env, orgId);
  if (auth instanceof Response) return auth;
  if (auth.memberId === memberId) {
    return jsonResponse({ error: "Admin cannot remove self" }, { status: 400 });
  }
  await env.DB.prepare(
    "UPDATE members SET removed_at = ? WHERE org_id = ? AND id = ? AND removed_at IS NULL"
  )
    .bind(new Date().toISOString(), orgId, memberId)
    .run();
  return jsonResponse({ ok: true });
}

async function handleBootstrap(
  request: Request,
  env: Env,
  orgId: string
): Promise<Response> {
  const auth = await getAuthContext(request, env, orgId);
  if (!auth) return jsonResponse({ error: "Unauthorized" }, { status: 401 });
  const org = await env.DB.prepare(
    "SELECT id, name, admin_member_id, created_at FROM orgs WHERE id = ?"
  )
    .bind(orgId)
    .first<StoredOrg>();
  if (!org) return jsonResponse({ error: "Org not found" }, { status: 404 });
  const members = await env.DB.prepare(
    "SELECT id, org_id, display_name, avatar_initials, avatar_variant, role, identity_kind, joined_at, removed_at FROM members WHERE org_id = ?"
  )
    .bind(orgId)
    .all<StoredMember>();
  return jsonResponse({
    org: publicOrg(org),
    members: members.results.map(publicMember),
  });
}

function routeToOrgRoom(
  request: Request,
  env: Env,
  orgId: string
): Response | Promise<Response> {
  const id = env.ORG_ROOMS.idFromName(orgId);
  return env.ORG_ROOMS.get(id).fetch(request);
}

export class CollabOrgRoom implements DurableObject {
  private sessions = new Set<WebSocket>();

  constructor(
    private state: DurableObjectState,
    private env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("upgrade");
    if (upgradeHeader !== "websocket") {
      return jsonResponse(
        { error: "WebSocket upgrade required" },
        { status: 426 }
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.sessions.add(server);
    server.accept();
    server.addEventListener("message", (event) => {
      for (const socket of this.sessions) {
        if (socket !== server && socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      }
    });
    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = matchCollabHubRoute(request);
    try {
      switch (route.kind) {
        case "createOrg":
          return await handleCreateOrg(request, env);
        case "createInvite":
          return await handleCreateInvite(request, env, route.orgId);
        case "acceptInvite":
          return await handleAcceptInvite(request, env, route.inviteCode);
        case "removeMember":
          return await handleRemoveMember(
            request,
            env,
            route.orgId,
            route.memberId
          );
        case "bootstrap":
          return await handleBootstrap(request, env, route.orgId);
        case "webSocket": {
          const auth = await getAuthContext(request, env, route.orgId);
          if (!auth)
            return jsonResponse({ error: "Unauthorized" }, { status: 401 });
          return routeToOrgRoom(request, env, route.orgId);
        }
        case "notFound":
          return jsonResponse({ error: "Not found" }, { status: 404 });
      }
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : "Internal error" },
        { status: 500 }
      );
    }
  },
};
