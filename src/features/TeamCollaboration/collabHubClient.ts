import { z } from "zod/v4";

import {
  buildCollabInviteLink,
  normalizeCollabHubUrl,
  parseCollabMessageEnvelope,
  toCollabWebSocketUrl,
} from "@src/store/collaboration/protocol";
import {
  CollabMemberRecordSchema,
  CollabOrgRecordSchema,
} from "@src/store/collaboration/protocol";
import type { CollabMessageEnvelope } from "@src/store/collaboration/protocol";
import type {
  CollabIdentityKind,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
} from "@src/store/collaboration/types";

const HubCreateOrgResponseSchema = z.object({
  org: CollabOrgRecordSchema,
  member: CollabMemberRecordSchema,
});

const HubCreateInviteResponseSchema = z.object({
  invite: z.object({
    id: z.string(),
    orgId: z.string(),
    inviteCode: z.string(),
    expiresAt: z.string().optional(),
    createdAt: z.string(),
  }),
});

const HubAcceptInviteResponseSchema = HubCreateOrgResponseSchema;

export interface CreateCollabOrgInput {
  hubUrl: string;
  name: string;
  displayName: string;
  identityKind: CollabIdentityKind;
}

export interface AcceptCollabInviteInput {
  hubUrl: string;
  inviteCode: string;
  displayName: string;
  identityKind: CollabIdentityKind;
}

export interface CreateCollabInviteInput {
  hubUrl: string;
  orgId: string;
  accessToken: string;
  expiresAt?: string;
  usageLimit?: number;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { authorization: `Bearer ${accessToken}` };
}

export async function createCollabOrg(
  input: CreateCollabOrgInput
): Promise<{ org: CollabOrgRecord; member: CollabMemberRecord }> {
  const hubUrl = normalizeCollabHubUrl(input.hubUrl);
  const response = await fetch(`${hubUrl}/orgs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      displayName: input.displayName,
      identityKind: input.identityKind,
    }),
  });
  const parsed = HubCreateOrgResponseSchema.parse(
    await parseJsonResponse(response)
  );
  return {
    org: { ...parsed.org, hubUrl, groupId: parsed.org.id },
    member: parsed.member,
  };
}

export async function acceptCollabInvite(
  input: AcceptCollabInviteInput
): Promise<{ org: CollabOrgRecord; member: CollabMemberRecord }> {
  const hubUrl = normalizeCollabHubUrl(input.hubUrl);
  const response = await fetch(
    `${hubUrl}/invites/${encodeURIComponent(input.inviteCode)}/accept`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: input.displayName,
        identityKind: input.identityKind,
      }),
    }
  );
  const parsed = HubAcceptInviteResponseSchema.parse(
    await parseJsonResponse(response)
  );
  return {
    org: { ...parsed.org, hubUrl, groupId: parsed.org.id },
    member: parsed.member,
  };
}

export async function createCollabInvite(
  input: CreateCollabInviteInput
): Promise<CollabInviteRecord> {
  const hubUrl = normalizeCollabHubUrl(input.hubUrl);
  const response = await fetch(
    `${hubUrl}/orgs/${encodeURIComponent(input.orgId)}/invites`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(input.accessToken),
      },
      body: JSON.stringify({
        expiresAt: input.expiresAt,
        usageLimit: input.usageLimit,
      }),
    }
  );
  const parsed = HubCreateInviteResponseSchema.parse(
    await parseJsonResponse(response)
  );
  const inviteLink = buildCollabInviteLink({
    hubUrl,
    inviteCode: parsed.invite.inviteCode,
  });
  return {
    id: parsed.invite.id,
    orgId: parsed.invite.orgId,
    hubUrl,
    inviteCode: parsed.invite.inviteCode,
    inviteLink,
    expiresAt: parsed.invite.expiresAt,
    createdAt: parsed.invite.createdAt,
  };
}

export interface CollabHubSocket {
  close: () => void;
  send: (message: CollabMessageEnvelope) => void;
}

export function connectCollabOrgRoom({
  hubUrl,
  orgId,
  accessToken,
  onMessage,
  onOpen,
  onClose,
  onError,
}: {
  hubUrl: string;
  orgId: string;
  accessToken: string;
  onMessage: (message: CollabMessageEnvelope) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Event) => void;
}): CollabHubSocket {
  const url = new URL(toCollabWebSocketUrl(hubUrl, orgId));
  url.searchParams.set("access_token", accessToken);
  const socket = new WebSocket(url.toString());

  socket.addEventListener("open", () => onOpen?.());
  socket.addEventListener("close", () => onClose?.());
  socket.addEventListener("error", (event) => onError?.(event));
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    onMessage(parseCollabMessageEnvelope(payload));
  });

  return {
    close: () => socket.close(),
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
  };
}
